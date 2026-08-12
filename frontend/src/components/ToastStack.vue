<script setup lang="ts">
export interface ToastMessage {
  id: number;
  message: string;
  error: boolean;
}

defineProps<{
  messages: ToastMessage[];
}>();
</script>

<template>
  <div class="toast-region" aria-live="assertive">
    <TransitionGroup name="toast">
      <div v-for="message in messages" :key="message.id" class="toast" :class="{ error: message.error }">
        {{ message.message }}
      </div>
    </TransitionGroup>
  </div>
</template>
