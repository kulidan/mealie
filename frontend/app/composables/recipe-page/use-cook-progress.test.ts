import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import {
  COOKING_STARTED_EXTRA,
  COOK_PROGRESS_MAX_AGE_MS,
  IN_PROGRESS_TAG_NAME,
  MANUAL_SESSION,
  getCookingSession,
  isCookingSessionStale,
  provideCookProgress,
  type CookProgress,
} from "./use-cook-progress";
import type { RecipeOut, TagOut } from "~/lib/api/types/recipe";

const patchOne = vi.fn();
const createTag = vi.fn();
const getTags = vi.fn();

vi.mock("~/composables/api", () => ({
  useUserApi: () => ({
    recipes: { patchOne },
    tags: { createOne: createTag, getAll: getTags },
  }),
}));

vi.mock("~/composables/store", () => ({
  resetTagStore: vi.fn(),
}));

const inProgressTag = { id: "tag-1", groupId: "g", name: IN_PROGRESS_TAG_NAME, slug: "in-progress" } as TagOut;
const otherTag = { id: "tag-2", groupId: "g", name: "Dessert", slug: "dessert" } as TagOut;

function makeRecipe(overrides: Partial<RecipeOut> = {}): RecipeOut {
  return { id: "recipe-1", slug: "apple-cake", tags: [], extras: {}, ...overrides } as RecipeOut;
}

function mountProvider(recipe: RecipeOut) {
  const recipeRef = ref(recipe);
  const onUpdated = vi.fn();
  let progress!: CookProgress;

  const wrapper = mount(defineComponent({
    setup() {
      progress = provideCookProgress(recipeRef, onUpdated);
      return () => null;
    },
  }));

  return { wrapper, progress, recipeRef, onUpdated };
}

describe("getCookingSession", () => {
  test("is null when the recipe is not tagged", () => {
    expect(getCookingSession(makeRecipe({ tags: [otherTag] }))).toBeNull();
  });

  test("uses the start time as the session id", () => {
    const recipe = makeRecipe({ tags: [inProgressTag], extras: { [COOKING_STARTED_EXTRA]: "2026-11-16T10:00:00.000Z" } });
    expect(getCookingSession(recipe)).toBe("2026-11-16T10:00:00.000Z");
  });

  test("falls back to the manual session when the tag has no start time", () => {
    expect(getCookingSession(makeRecipe({ tags: [inProgressTag] }))).toBe(MANUAL_SESSION);
  });
});

describe("isCookingSessionStale", () => {
  const startedAt = "2026-11-16T10:00:00.000Z";
  const start = Date.parse(startedAt);

  test("is false inside the time limit", () => {
    expect(isCookingSessionStale(startedAt, start + COOK_PROGRESS_MAX_AGE_MS)).toBe(false);
  });

  test("is true after the time limit", () => {
    expect(isCookingSessionStale(startedAt, start + COOK_PROGRESS_MAX_AGE_MS + 1)).toBe(true);
  });

  test("is false when there is no start time to measure", () => {
    expect(isCookingSessionStale(null)).toBe(false);
    expect(isCookingSessionStale(MANUAL_SESSION)).toBe(false);
    expect(isCookingSessionStale("not a date")).toBe(false);
  });
});

describe("provideCookProgress", () => {
  beforeEach(() => {
    localStorage.clear();
    patchOne.mockReset();
    createTag.mockReset();
    getTags.mockReset();
    getTags.mockResolvedValue({ data: { items: [inProgressTag] } });
  });

  test("start adds the tag and the start time", async () => {
    const updated = makeRecipe({ tags: [inProgressTag] });
    patchOne.mockResolvedValue({ data: updated });
    const { progress, onUpdated } = mountProvider(makeRecipe({ tags: [otherTag], extras: { keep: "me" } }));

    await progress.start();

    expect(patchOne).toHaveBeenCalledTimes(1);
    const [slug, payload] = patchOne.mock.calls[0];
    expect(slug).toBe("apple-cake");
    expect(payload.tags.map((t: TagOut) => t.name)).toEqual(["Dessert", IN_PROGRESS_TAG_NAME]);
    expect(payload.extras.keep).toBe("me");
    expect(Date.parse(payload.extras[COOKING_STARTED_EXTRA])).not.toBeNaN();
    expect(onUpdated).toHaveBeenCalledWith(updated);
  });

  test("start creates the tag when it does not exist", async () => {
    getTags.mockResolvedValue({ data: { items: [] } });
    createTag.mockResolvedValue({ data: inProgressTag });
    patchOne.mockResolvedValue({ data: makeRecipe({ tags: [inProgressTag] }) });
    const { progress } = mountProvider(makeRecipe());

    await progress.start();

    expect(createTag).toHaveBeenCalledWith({ name: IN_PROGRESS_TAG_NAME });
    expect(patchOne.mock.calls[0][1].tags).toEqual([inProgressTag]);
  });

  test("finish removes the tag and the start time, and keeps other data", async () => {
    patchOne.mockResolvedValue({ data: makeRecipe() });
    const { progress } = mountProvider(makeRecipe({
      tags: [otherTag, inProgressTag],
      extras: { keep: "me", [COOKING_STARTED_EXTRA]: new Date().toISOString() },
    }));

    await progress.finish();

    const payload = patchOne.mock.calls[0][1];
    expect(payload.tags).toEqual([otherTag]);
    expect(payload.extras).toEqual({ keep: "me" });
  });

  test("keeps progress only while the recipe is in progress", async () => {
    const session = new Date().toISOString();
    const { progress, recipeRef } = mountProvider(makeRecipe());

    progress.setDoneSteps(["step-1"]);
    expect(progress.doneSteps.value).toEqual([]);

    recipeRef.value = makeRecipe({ tags: [inProgressTag], extras: { [COOKING_STARTED_EXTRA]: session } });
    await nextTick();

    progress.setDoneSteps(["step-1"]);
    progress.setIngredientChecked("ref:a", true);
    expect(progress.isInProgress.value).toBe(true);
    expect(progress.doneSteps.value).toEqual(["step-1"]);
    expect(progress.checkedIngredients.value).toEqual({ "ref:a": true });

    recipeRef.value = makeRecipe();
    await nextTick();

    expect(progress.doneSteps.value).toEqual([]);
    expect(progress.checkedIngredients.value).toEqual({});
  });

  test("discards saved progress that belongs to an earlier session", async () => {
    localStorage.setItem("recipe-cook-progress:recipe-1", JSON.stringify({
      session: "2026-11-15T08:00:00.000Z",
      doneSteps: ["old-step"],
      checkedIngredients: { "ref:old": true },
    }));

    const { progress } = mountProvider(makeRecipe({
      tags: [inProgressTag],
      extras: { [COOKING_STARTED_EXTRA]: new Date().toISOString() },
    }));

    expect(progress.doneSteps.value).toEqual([]);
    expect(progress.checkedIngredients.value).toEqual({});
  });

  test("ends a session that is older than the time limit", async () => {
    patchOne.mockResolvedValue({ data: makeRecipe() });
    const startedAt = new Date(Date.now() - COOK_PROGRESS_MAX_AGE_MS - 60_000).toISOString();

    mountProvider(makeRecipe({ tags: [inProgressTag], extras: { [COOKING_STARTED_EXTRA]: startedAt } }));
    await nextTick();

    expect(patchOne).toHaveBeenCalledTimes(1);
    expect(patchOne.mock.calls[0][1].tags).toEqual([]);
  });
});
