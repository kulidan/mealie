<template>
  <v-btn
    v-if="cookProgress"
    rounded
    variant="outlined"
    size="large"
    :loading="cookProgress.loading.value"
    :color="cookProgress.isInProgress.value ? 'success' : 'primary'"
    @click="toggle"
  >
    <v-icon start size="large">
      {{ cookProgress.isInProgress.value ? $globals.icons.check : $globals.icons.chefHat }}
    </v-icon>
    {{ cookProgress.isInProgress.value ? $t("recipe.finish-cooking") : $t("recipe.start-cooking") }}
  </v-btn>
</template>

<script setup lang="ts">
import { useCookProgress } from "~/composables/recipe-page/use-cook-progress";

const cookProgress = useCookProgress();

function toggle() {
  if (!cookProgress) {
    return;
  }

  if (cookProgress.isInProgress.value) {
    cookProgress.finish();
  }
  else {
    cookProgress.start();
  }
}
</script>
