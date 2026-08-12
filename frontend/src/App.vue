<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Cable } from "@lucide/vue";
import { apiRequest } from "./api";
import ConnectionPanel from "./components/ConnectionPanel.vue";
import ToastStack, { type ToastMessage } from "./components/ToastStack.vue";
import TrafficConsole from "./components/TrafficConsole.vue";
import { useCommunication } from "./composables/useCommunication";
import type { TransportMode, TransportStatus } from "./types";

const toasts = ref<ToastMessage[]>([]);
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

const modeNames: Record<TransportMode, string> = {
  serial: "串口",
  tcp_client: "TCP Client",
  tcp_server: "TCP Server",
  udp: "UDP",
};

const statusText = computed(() => {
  if (!status.value.connected || !status.value.mode) return "未连接";
  return `${modeNames[status.value.mode]} 已连接`;
});

const statusDetail = computed(() => {
  const details = status.value.details;
  if (!status.value.connected) return "配置通信参数后建立连接";
  if (status.value.mode === "serial") return `${String(details.port)} · ${String(details.baudrate)} baud`;
  if (status.value.mode === "tcp_client") return `${String(details.host)}:${String(details.port)}`;
  if (status.value.mode === "tcp_server") {
    return `${String(details.host)}:${String(details.port)} · ${Number(details.client_count ?? 0)} 个客户端`;
  }
  if (status.value.mode === "udp") {
    const remote = details.remote ? ` → ${String(details.remote)}` : "";
    return `${String(details.local_host)}:${String(details.local_port)}${remote}`;
  }
  return "通信已连接";
});

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
          <p>串口与网络调试工具</p>
        </div>
      </div>
      <div class="connection-state" aria-live="polite">
        <span class="status-dot" :class="{ connected: status.connected }"></span>
        <div>
          <strong>{{ statusText }}</strong>
          <span>{{ statusDetail }}</span>
        </div>
      </div>
    </header>

    <main class="workspace">
      <ConnectionPanel :status="status" @status="applyStatus" @error="showToast" />
      <TrafficConsole
        v-model:paused="paused"
        :connected="status.connected"
        :events-connected="eventsConnected"
        :logs="logs"
        @clear="clearLogs"
        @error="showToast"
      />
    </main>
  </div>
  <ToastStack :messages="toasts" />
</template>
