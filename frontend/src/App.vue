<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Cable, Moon, Sun } from "@lucide/vue";
import { apiRequest } from "./api";
import ConnectionBar from "./components/ConnectionBar.vue";
import ConfigurationProfiles from "./components/ConfigurationProfiles.vue";
import FrameAnalyzer from "./components/FrameAnalyzer.vue";
import ToastStack, { type ToastMessage } from "./components/ToastStack.vue";
import TrafficConsole from "./components/TrafficConsole.vue";
import { useCommunication } from "./composables/useCommunication";
import { loadActiveProfileId, loadTheme, saveTheme, type Theme } from "./storage";
import type { PeriodicSendStatus, TransportStatus } from "./types";

const toasts = ref<ToastMessage[]>([]);
const theme = ref<Theme>(loadTheme());
const query = new URLSearchParams(window.location.search);
const requestedTool = query.get("tool");
const detachedTool = ref<"presets" | "dashboard" | "parser" | null>(
  requestedTool === "presets" || requestedTool === "dashboard" || requestedTool === "parser" ? requestedTool : null,
);
const requestedProfileId = query.get("profile");
const activeProfileId = ref(requestedProfileId?.slice(0, 80) || loadActiveProfileId());
const trafficConsole = ref<InstanceType<typeof TrafficConsole> | null>(null);
let nextToastId = 1;

function showToast(message: string, error = true): void {
  const id = nextToastId++;
  toasts.value.push({ id, message, error });
  window.setTimeout(() => {
    const index = toasts.value.findIndex((toast) => toast.id === id);
    if (index >= 0) toasts.value.splice(index, 1);
  }, 3_500);
}

const {
  status,
  periodicStatus,
  logs,
  receivedFrames,
  paused,
  eventsConnected,
  applyStatus,
  applyPeriodicStatus,
  clearLogs,
} = useCommunication(showToast);

const profileSwitchLocked = computed(() => (
  status.value.connected
  || status.value.details.reconnecting === true
  || periodicStatus.value.active
));

function toggleTheme(): void {
  theme.value = theme.value === "light" ? "dark" : "light";
  saveTheme(theme.value);
}

function persistActiveProfile(): void {
  trafficConsole.value?.persistPendingState();
}

function switchDetachedAnalyzer(view: "dashboard" | "parser"): void {
  detachedTool.value = view;
  const url = new URL(window.location.href);
  url.searchParams.set("tool", view);
  window.history.replaceState(null, "", url);
  document.title = `${view === "dashboard" ? "实时仪表盘" : "解析配置"} - Serial Network Debugger`;
}

function closeDetachedWindow(): void {
  window.close();
}

onMounted(async () => {
  if (detachedTool.value) {
    const titles = { presets: "发送预设", dashboard: "实时仪表盘", parser: "解析配置" };
    document.title = `${titles[detachedTool.value]} - Serial Network Debugger`;
  }
  try {
    applyStatus(await apiRequest<TransportStatus>("/api/status"));
    applyPeriodicStatus(await apiRequest<PeriodicSendStatus>("/api/periodic-send"));
  } catch (error) {
    showToast(error instanceof Error ? error.message : "无法读取服务状态");
  }
});
</script>

<template>
  <div v-if="detachedTool" class="detached-tool-shell">
    <FrameAnalyzer
      v-if="detachedTool === 'dashboard' || detachedTool === 'parser'"
      :profile-id="activeProfileId"
      :frames="receivedFrames"
      :view="detachedTool"
      @request-view="switchDetachedAnalyzer"
      @error="showToast"
    />
    <TrafficConsole
      v-else
      ref="trafficConsole"
      :profile-id="activeProfileId"
      v-model:paused="paused"
      :connected="status.connected"
      :logs="logs"
      :received-frames="receivedFrames"
      :periodic-status="periodicStatus"
      tool-only="presets"
      @close-tool="closeDetachedWindow"
      @error="showToast"
      @periodic-status="applyPeriodicStatus"
    />
  </div>
  <div v-else class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><Cable :size="21" /></span>
        <div class="brand-copy">
          <h1>Serial Network Debugger</h1>
        </div>
      </div>
      <ConfigurationProfiles
        :active-profile-id="activeProfileId"
        :locked="profileSwitchLocked"
        @select="activeProfileId = $event"
        @prepare="persistActiveProfile"
        @error="showToast"
      />
      <ConnectionBar
        :key="activeProfileId"
        :profile-id="activeProfileId"
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
        ref="trafficConsole"
        :key="activeProfileId"
        :profile-id="activeProfileId"
        v-model:paused="paused"
        :connected="status.connected"
        :logs="logs"
        :received-frames="receivedFrames"
        :periodic-status="periodicStatus"
        @clear="clearLogs"
        @error="showToast"
        @periodic-status="applyPeriodicStatus"
      />
    </main>
  </div>
  <ToastStack :messages="toasts" />
</template>
