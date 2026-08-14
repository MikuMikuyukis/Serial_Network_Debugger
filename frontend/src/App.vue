<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Cable, Download, Moon, Save, Sun, Upload } from "@lucide/vue";
import { apiRequest } from "./api";
import ConnectionBar from "./components/ConnectionBar.vue";
import ConfigurationProfiles from "./components/ConfigurationProfiles.vue";
import FrameAnalyzer from "./components/FrameAnalyzer.vue";
import ToastStack, { type ToastMessage } from "./components/ToastStack.vue";
import TrafficConsole from "./components/TrafficConsole.vue";
import { useCommunication } from "./composables/useCommunication";
import {
  CONFIGURATION_IMPORT_EVENT_KEY,
  createConfigurationBackup,
  importConfigurationBackup,
  loadActiveProfileId,
  loadTheme,
  parseConfigurationBackup,
  saveTheme,
  type Theme,
} from "./storage";
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
const configurationProfiles = ref<InstanceType<typeof ConfigurationProfiles> | null>(null);
const connectionBar = ref<InstanceType<typeof ConnectionBar> | null>(null);
const trafficConsole = ref<InstanceType<typeof TrafficConsole> | null>(null);
const standaloneAnalyzer = ref<InstanceType<typeof FrameAnalyzer> | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const MAX_IMPORT_FILE_SIZE = 32 * 1024 * 1024;
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

function persistActiveProfile(notify = false): boolean {
  const profilesSaved = configurationProfiles.value?.persistPendingState() ?? true;
  const connectionSaved = connectionBar.value?.persistPendingState() ?? true;
  const trafficSaved = trafficConsole.value?.persistPendingState() ?? true;
  const analyzerSaved = standaloneAnalyzer.value?.persistPendingState() ?? true;
  const saved = profilesSaved && connectionSaved && trafficSaved && analyzerSaved;
  if (notify && saved) showToast("全部配置已保存", false);
  return saved;
}

function handleGlobalSave(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
  event.preventDefault();
  persistActiveProfile(true);
}

function handleCrossWindowConfigurationImport(event: StorageEvent): void {
  if (event.storageArea === localStorage && event.key === CONFIGURATION_IMPORT_EVENT_KEY) {
    window.location.reload();
  }
}

function exportAllConfiguration(): void {
  if (!persistActiveProfile()) return;
  try {
    const backup = createConfigurationBackup();
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = configurationBackupFilename(backup.exported_at);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`已导出 ${backup.profiles.length} 组配置`, false);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "配置导出失败");
  }
}

function requestConfigurationImport(): void {
  if (profileSwitchLocked.value) {
    showToast("断开通信并停止周期发送后才能导入配置");
    return;
  }
  importInput.value?.click();
}

async function handleConfigurationImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (profileSwitchLocked.value) {
    showToast("断开通信并停止周期发送后才能导入配置");
    return;
  }
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    showToast("配置文件不能超过 32 MiB");
    return;
  }
  try {
    const backup = parseConfigurationBackup(await file.text());
    if (!window.confirm(`导入将替换当前全部配置。确定导入 ${backup.profiles.length} 组配置吗？`)) return;
    if (profileSwitchLocked.value) {
      showToast("断开通信并停止周期发送后才能导入配置");
      return;
    }
    if (!persistActiveProfile()) return;
    importConfigurationBackup(backup);
    showToast(`已导入 ${backup.profiles.length} 组配置，正在重新加载`, false);
    window.setTimeout(() => window.location.reload(), 300);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "配置导入失败");
  }
}

function configurationBackupFilename(exportedAt: string): string {
  const timestamp = exportedAt.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `serial-network-debugger-config-${timestamp}.json`;
}

function closeDetachedWindow(): void {
  window.close();
}

onMounted(async () => {
  window.addEventListener("keydown", handleGlobalSave);
  window.addEventListener("storage", handleCrossWindowConfigurationImport);
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

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalSave);
  window.removeEventListener("storage", handleCrossWindowConfigurationImport);
});
</script>

<template>
  <div v-if="detachedTool" class="detached-tool-shell">
    <FrameAnalyzer
      ref="standaloneAnalyzer"
      v-if="detachedTool === 'dashboard' || detachedTool === 'parser'"
      :profile-id="activeProfileId"
      :frames="receivedFrames"
      :view="detachedTool"
      standalone
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
        ref="configurationProfiles"
        :active-profile-id="activeProfileId"
        :locked="profileSwitchLocked"
        @select="activeProfileId = $event"
        @prepare="persistActiveProfile"
        @error="showToast"
      />
      <ConnectionBar
        ref="connectionBar"
        :key="activeProfileId"
        :profile-id="activeProfileId"
        :status="status"
        :events-connected="eventsConnected"
        @status="applyStatus"
        @error="showToast"
      />
      <div class="configuration-file-actions">
        <button class="bar-icon-button" type="button" title="保存全部配置" aria-label="保存全部配置" @click="persistActiveProfile(true)">
          <Save :size="17" />
        </button>
        <button class="bar-icon-button" type="button" title="导出全部配置" aria-label="导出全部配置" @click="exportAllConfiguration">
          <Download :size="17" />
        </button>
        <button
          class="bar-icon-button"
          type="button"
          title="导入全部配置"
          aria-label="导入全部配置"
          :disabled="profileSwitchLocked"
          @click="requestConfigurationImport"
        >
          <Upload :size="17" />
        </button>
        <input ref="importInput" class="configuration-file-input" type="file" accept="application/json,.json" @change="handleConfigurationImport" />
      </div>
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
