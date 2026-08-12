<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Cable, Moon, Sun } from "@lucide/vue";
import { apiRequest } from "./api";
import ConnectionBar from "./components/ConnectionBar.vue";
import ToastStack, { type ToastMessage } from "./components/ToastStack.vue";
import TrafficConsole from "./components/TrafficConsole.vue";
import { useCommunication } from "./composables/useCommunication";
import { loadTheme, saveTheme, type Theme } from "./storage";
import type { TransportStatus } from "./types";

const toasts = ref<ToastMessage[]>([]);
const theme = ref<Theme>(loadTheme());
let nextToastId = 1;

function showToast(message: string, error = true): void {
  const id = nextToastId++;
  toasts.value.push({ id, message, error });
  window.setTimeout(() => {
    const index = toasts.value.findIndex((toast) => toast.id === id);
    if (index >= 0) toasts.value.splice(index, 1);
  }, 3_500);
}

const { status, logs, paused, eventsConnected, applyStatus, clearLogs } = useCommunication(showToast);

function toggleTheme(): void {
  theme.value = theme.value === "light" ? "dark" : "light";
  saveTheme(theme.value);
}

onMounted(async () => {
  try {
    applyStatus(await apiRequest<TransportStatus>("/api/status"));
  } catch (error) {
    showToast(error instanceof Error ? error.message : "无法读取服务状态");
  }
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><Cable :size="21" /></span>
        <div class="brand-copy">
          <h1>Serial Network Debugger</h1>
        </div>
      </div>
      <ConnectionBar
        :status="status"
        :events-connected="eventsConnected"
        @status="applyStatus"
        @error="showToast"
      />
      <button
        class="theme-button"
        type="button"
        :title="theme === 'light' ? '切换到深色模式' : '切换到浅色模式'"
        :aria-label="theme === 'light' ? '切换到深色模式' : '切换到浅色模式'"
        @click="toggleTheme"
      >
        <Moon v-if="theme === 'light'" :size="18" />
        <Sun v-else :size="18" />
      </button>
    </header>

    <main class="workspace">
      <TrafficConsole
        v-model:paused="paused"
        :connected="status.connected"
        :logs="logs"
        @clear="clearLogs"
        @error="showToast"
      />
    </main>
  </div>
  <ToastStack :messages="toasts" />
</template>
