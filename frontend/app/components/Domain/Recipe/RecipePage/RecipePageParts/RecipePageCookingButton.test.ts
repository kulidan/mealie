import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { computed, ref } from "vue";
import { createI18n } from "vue-i18n";
import messages from "@/lang/messages/en-US.json";
import RecipePageCookingButton from "./RecipePageCookingButton.vue";
import { useCookProgress, type CookProgress } from "~/composables/recipe-page/use-cook-progress";

vi.mock("~/composables/recipe-page/use-cook-progress");

const start = vi.fn();
const finish = vi.fn();

function mockProgress(inProgress: boolean) {
  vi.mocked(useCookProgress).mockReturnValue({
    isInProgress: computed(() => inProgress),
    loading: ref(false),
    start,
    finish,
  } as unknown as CookProgress);
}

function mountButton() {
  return mount(RecipePageCookingButton, {
    global: {
      plugins: [createI18n({ legacy: false, locale: "en-US", messages: { "en-US": messages } })],
      mocks: {
        $globals: { icons: { check: "check-icon", chefHat: "chef-icon" } },
      },
      stubs: {
        VBtn: { template: "<button class=\"cooking-btn\"><slot /></button>" },
        VIcon: { template: "<i><slot /></i>" },
      },
    },
  });
}

describe("RecipePageCookingButton", () => {
  beforeEach(() => {
    start.mockReset();
    finish.mockReset();
    vi.mocked(useCookProgress).mockReset();
  });

  test("starts cooking when the recipe is not in progress", async () => {
    mockProgress(false);
    const wrapper = mountButton();

    expect(wrapper.text()).toContain("Start Cooking");
    await wrapper.find(".cooking-btn").trigger("click");

    expect(start).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
  });

  test("finishes cooking when the recipe is in progress", async () => {
    mockProgress(true);
    const wrapper = mountButton();

    expect(wrapper.text()).toContain("Finish Cooking");
    await wrapper.find(".cooking-btn").trigger("click");

    expect(finish).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  test("shows nothing outside of the recipe page", () => {
    vi.mocked(useCookProgress).mockReturnValue(null);

    expect(mountButton().find(".cooking-btn").exists()).toBe(false);
  });
});
