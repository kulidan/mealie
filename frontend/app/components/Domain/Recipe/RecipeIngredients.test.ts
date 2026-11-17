import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { computed, nextTick, ref } from "vue";
import RecipeIngredients from "./RecipeIngredients.vue";
import type { RecipeIngredient } from "~/lib/api/types/recipe";
import { useCookProgress, type CookProgress } from "~/composables/recipe-page/use-cook-progress";
import { useLocales } from "~/composables/use-locales";

vi.mock("~/composables/use-locales");
vi.mock("~/composables/recipe-page/use-cook-progress");

const ingredients = {
  curryPaste: {
    referenceId: "ingredient-curry-paste",
    quantity: 1,
    food: { id: "food-1", name: "curry paste" },
  },
  coconutMilk: {
    referenceId: "ingredient-coconut-milk",
    quantity: 1,
    food: { id: "food-2", name: "coconut milk" },
  },
} satisfies Record<string, RecipeIngredient>;

function mountIngredients(value: RecipeIngredient[], storageKey = "recipe-ingredients:test-recipe:checked") {
  return mount(RecipeIngredients, {
    props: {
      value,
      storageKey,
    },
    global: {
      stubs: {
        AppButtonCopy: true,
        RecipeIngredientListItem: true,
        VCheckbox: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `
            <button
              class="checkbox"
              type="button"
              :aria-pressed="modelValue ? 'true' : 'false'"
              @click="$emit('update:modelValue', !modelValue)"
            />
          `,
        },
        VDivider: true,
        VListItem: {
          template: "<div class=\"list-item\" @click=\"$emit('click', $event)\"><slot name=\"prepend\" /><slot /></div>",
        },
        VListItemTitle: {
          template: "<div><slot /></div>",
        },
      },
    },
  });
}

describe("RecipeIngredients", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.mocked(useCookProgress).mockReset();
    vi.mocked(useLocales).mockReturnValue({
      locales: [{ value: "en-US", pluralFoodHandling: "always" }],
      locale: { value: "en-US", pluralFoodHandling: "always" },
    } as any);
  });

  test("keeps checked ingredients in the cooking session while the recipe is in progress", async () => {
    const checked = ref<Record<string, boolean>>({});
    const setIngredientChecked = vi.fn((key: string, value: boolean) => {
      checked.value = { ...checked.value, [key]: value };
    });
    vi.mocked(useCookProgress).mockReturnValue({
      isInProgress: computed(() => true),
      checkedIngredients: computed(() => checked.value),
      setIngredientChecked,
    } as unknown as CookProgress);

    const wrapper = mountIngredients([ingredients.curryPaste, ingredients.coconutMilk]);
    await wrapper.findAll(".checkbox")[1].trigger("click");
    await nextTick();

    expect(setIngredientChecked).toHaveBeenCalledWith("ref:ingredient-coconut-milk", true);
    expect(wrapper.findAll(".checkbox")[1].attributes("aria-pressed")).toBe("true");
  });

  test("restores checked ingredients of a recipe in progress by reference id", async () => {
    vi.mocked(useCookProgress).mockReturnValue({
      isInProgress: computed(() => true),
      checkedIngredients: computed(() => ({ "ref:ingredient-curry-paste": true })),
      setIngredientChecked: vi.fn(),
    } as unknown as CookProgress);

    const wrapper = mountIngredients([ingredients.coconutMilk, ingredients.curryPaste]);

    expect(wrapper.findAll(".checkbox")[0].attributes("aria-pressed")).toBe("false");
    expect(wrapper.findAll(".checkbox")[1].attributes("aria-pressed")).toBe("true");
  });

  test("does not bring back old checks after the cooking session ends", async () => {
    const inProgress = ref(false);
    const checked = ref<Record<string, boolean>>({});
    vi.mocked(useCookProgress).mockReturnValue({
      isInProgress: computed(() => inProgress.value),
      checkedIngredients: computed(() => checked.value),
      setIngredientChecked: (key: string, value: boolean) => {
        checked.value = { ...checked.value, [key]: value };
      },
    } as unknown as CookProgress);

    const wrapper = mountIngredients([ingredients.curryPaste, ingredients.coconutMilk]);
    await wrapper.findAll(".checkbox")[0].trigger("click");
    expect(wrapper.findAll(".checkbox")[0].attributes("aria-pressed")).toBe("true");

    inProgress.value = true;
    await nextTick();
    expect(wrapper.findAll(".checkbox")[0].attributes("aria-pressed")).toBe("true");

    await wrapper.findAll(".checkbox")[1].trigger("click");
    inProgress.value = false;
    checked.value = {};
    await nextTick();

    expect(wrapper.findAll(".checkbox")[0].attributes("aria-pressed")).toBe("false");
    expect(wrapper.findAll(".checkbox")[1].attributes("aria-pressed")).toBe("false");
  });

  test("restores checked ingredients from session storage by reference id", async () => {
    const firstWrapper = mountIngredients([ingredients.curryPaste, ingredients.coconutMilk]);
    await firstWrapper.findAll(".checkbox")[0].trigger("click");
    await nextTick();

    expect(firstWrapper.findAll(".checkbox")[0].attributes("aria-pressed")).toBe("true");
    firstWrapper.unmount();

    const secondWrapper = mountIngredients([ingredients.coconutMilk, ingredients.curryPaste]);

    expect(secondWrapper.findAll(".checkbox")[0].attributes("aria-pressed")).toBe("false");
    expect(secondWrapper.findAll(".checkbox")[1].attributes("aria-pressed")).toBe("true");
  });
});
