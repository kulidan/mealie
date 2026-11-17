import { useLocalStorage } from "@vueuse/core";
import { computed, inject, onMounted, provide, ref, watch } from "vue";
import type { ComputedRef, InjectionKey, Ref } from "vue";
import { useUserApi } from "~/composables/api";
import { resetTagStore } from "~/composables/store";
import type { RecipeOut, TagOut } from "~/lib/api/types/recipe";

/**
 * Name of the tag that marks a recipe as "being cooked now". The "In Progress" cookbook
 * filters on this tag.
 */
export const IN_PROGRESS_TAG_NAME = "In Progress";

/** Key in `recipe.extras` that holds the time the cooking session started. */
export const COOKING_STARTED_EXTRA = "cookingStartedAt";

/** A cooking session that is older than this is ended automatically. */
export const COOK_PROGRESS_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Session id for a recipe that was tagged by hand and has no start time. */
export const MANUAL_SESSION = "manual";

/**
 * Identifies a step by its position and its text. The ids of the steps are not stable, because
 * the server makes new ones each time it saves the recipe, which it does when a session starts.
 * A step that the cook edits during the session loses its done mark, which is acceptable.
 */
export function stepKey(step: { title?: string | null; summary?: string | null; text?: string | null }, index: number): string {
  const content = [step.title, step.summary, step.text].map(part => part ?? "").join("\u0000");

  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash * 33) ^ content.charCodeAt(i)) >>> 0;
  }

  return `${index}:${hash.toString(36)}`;
}

export interface CookProgressState {
  /** The session this data belongs to. Data from any other session is discarded. */
  session: string | null;
  /** Keys of the steps the cook marked as done, made by `stepKey`. */
  doneSteps: string[];
  /** Checked ingredients, keyed like `RecipeIngredients` keys them. */
  checkedIngredients: Record<string, boolean>;
}

function emptyState(session: string | null = null): CookProgressState {
  return { session, doneSteps: [], checkedIngredients: {} };
}

export function hasInProgressTag(recipe: Pick<RecipeOut, "tags">): boolean {
  return (recipe.tags ?? []).some(tag => tag.name === IN_PROGRESS_TAG_NAME);
}

/**
 * Identifies the current cooking session of a recipe, or null when it is not being cooked.
 * Starting a new session gives a new id, so progress from an earlier session is not reused.
 */
export function getCookingSession(recipe: Pick<RecipeOut, "tags" | "extras">): string | null {
  if (!hasInProgressTag(recipe)) {
    return null;
  }

  const startedAt = recipe.extras?.[COOKING_STARTED_EXTRA];
  return typeof startedAt === "string" && startedAt ? startedAt : MANUAL_SESSION;
}

export function isCookingSessionStale(session: string | null, now: number = Date.now()): boolean {
  if (!session || session === MANUAL_SESSION) {
    return false;
  }

  const startedAt = Date.parse(session);
  if (Number.isNaN(startedAt)) {
    return false;
  }

  return now - startedAt > COOK_PROGRESS_MAX_AGE_MS;
}

export interface CookProgress {
  /** True while the recipe carries the "In Progress" tag. */
  isInProgress: ComputedRef<boolean>;
  /** True while a start or finish request is running. */
  loading: Ref<boolean>;
  doneSteps: ComputedRef<string[]>;
  checkedIngredients: ComputedRef<Record<string, boolean>>;
  setDoneSteps: (stepKeys: string[]) => void;
  setIngredientChecked: (key: string, checked: boolean) => void;
  start: () => Promise<void>;
  finish: () => Promise<void>;
}

const cookProgressKey: InjectionKey<CookProgress> = Symbol("cook-progress");

/**
 * Tracks a cooking session for one recipe and makes it available to the components below the
 * caller. The In Progress tag and the start time are stored on the server, so every device sees
 * which recipes are being cooked. Checked steps and ingredients stay in this browser.
 *
 * @param recipe The recipe that the page shows.
 * @param onUpdated Called with the saved recipe after a session starts or ends.
 */
export function provideCookProgress(recipe: Ref<RecipeOut>, onUpdated: (updated: RecipeOut) => void): CookProgress {
  const api = useUserApi();
  const loading = ref(false);

  const session = computed(() => getCookingSession(recipe.value));
  const isInProgress = computed(() => session.value !== null);

  const storage = useLocalStorage<CookProgressState>(
    `recipe-cook-progress:${recipe.value.id || recipe.value.slug}`,
    emptyState(),
    // do not write an empty entry for every recipe that is only viewed
    { mergeDefaults: true, writeDefaults: false },
  );

  watch(session, (current) => {
    if (storage.value.session !== current) {
      storage.value = emptyState(current);
    }
  }, { immediate: true });

  const doneSteps = computed(() => (isInProgress.value ? storage.value.doneSteps : []));
  const checkedIngredients = computed(() => (isInProgress.value ? storage.value.checkedIngredients : {}));

  function setDoneSteps(stepKeys: string[]) {
    if (isInProgress.value) {
      storage.value = { ...storage.value, doneSteps: stepKeys };
    }
  }

  function setIngredientChecked(key: string, checked: boolean) {
    if (isInProgress.value) {
      storage.value = {
        ...storage.value,
        checkedIngredients: { ...storage.value.checkedIngredients, [key]: checked },
      };
    }
  }

  async function findOrCreateTag(): Promise<TagOut | null> {
    const { data: existing } = await api.tags.getAll(1, 1, { queryFilter: `name = "${IN_PROGRESS_TAG_NAME}"` });
    if (existing?.items?.length) {
      return existing.items[0];
    }

    const { data } = await api.tags.createOne({ name: IN_PROGRESS_TAG_NAME });
    if (data) {
      // lists of tags that are already loaded do not know about the new tag
      resetTagStore();
    }
    return data ?? null;
  }

  async function save(tags: TagOut[], extras: Record<string, unknown>) {
    const { data } = await api.recipes.patchOne(recipe.value.slug, { tags, extras });
    if (data) {
      onUpdated(data);
    }
  }

  async function start() {
    if (isInProgress.value || loading.value) {
      return;
    }

    loading.value = true;
    try {
      const tag = await findOrCreateTag();
      if (!tag) {
        return;
      }

      await save(
        [...recipe.value.tags, tag],
        { ...(recipe.value.extras ?? {}), [COOKING_STARTED_EXTRA]: new Date().toISOString() },
      );
    }
    finally {
      loading.value = false;
    }
  }

  async function finish() {
    if (!isInProgress.value || loading.value) {
      return;
    }

    loading.value = true;
    try {
      const extras = Object.fromEntries(
        Object.entries(recipe.value.extras ?? {}).filter(([key]) => key !== COOKING_STARTED_EXTRA),
      );

      await save(recipe.value.tags.filter(tag => tag.name !== IN_PROGRESS_TAG_NAME), extras);
    }
    finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    if (isCookingSessionStale(session.value)) {
      finish();
    }
  });

  const progress: CookProgress = {
    isInProgress,
    loading,
    doneSteps,
    checkedIngredients,
    setDoneSteps,
    setIngredientChecked,
    start,
    finish,
  };

  provide(cookProgressKey, progress);
  return progress;
}

/** Returns the cooking session that the recipe page provides, or null outside of it. */
export function useCookProgress(): CookProgress | null {
  return inject(cookProgressKey, null);
}
