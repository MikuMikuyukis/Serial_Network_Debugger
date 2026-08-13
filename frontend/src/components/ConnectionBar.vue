<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Link, Power, RefreshCw, Settings, X } from "@lucide/vue";
import { apiRequest } from "../api";
import {
  cloneTransportSettings,
  loadTransportSettings,
  saveTransportSettings,
  type TransportSettings,
} from "../storage";
import type { SerialPortInfo, TransportConfig, TransportMode, TransportStatus } from "../types";

const props = defineProps<{
  profileId: string;
  status: TransportStatus;
  eventsConnected: boolean;
}>();

const emit = defineEmits<{
  status: [status: TransportStatus];
  error: [message: string];
}>();

const modes: Array<{ value: TransportMode; label: string }> = [
  { value: "serial", label: "串口" },
  { value: "tcp_client", label: "TCP Client" },
  { value: "tcp_server", label: "TCP Server" },
  { value: "udp", label: "UDP" },
];

const settings = ref<TransportSettings>(loadTransportSettings(props.profileId));
const draft = ref<TransportSettings>(cloneTransportSettings(settings.value));
const serialPorts = ref<SerialPortInfo[]>([]);
const modalOpen = ref(false);
const busy = ref(false);
const refreshingPorts = ref(false);

const connected = computed(() => props.status.connected);
const reconnecting = computed(() => (
  props.status.mode === "tcp_client" && props.status.details.reconnecting === true
));
const sessionActive = computed(() => connected.value || reconnecting.value);
const effectiveMode = computed(() => props.status.mode ?? settings.value.mode);
const modeLabel = computed(() => modes.find((item) => item.value === effectiveMode.value)?.label ?? "通信");
const summary = computed(() => sessionActive.value ? summarizeStatus(props.status) : summarizeConfig(settings.value));

watch(
  () => props.status,
  (status) => {
    if ((status.connected || status.details.reconnecting === true) && status.mode) {
      settings.value.mode = status.mode;
    }
  },
  { immediate: true },
);

function openSettings(): void {
  draft.value = cloneTransportSettings(settings.value);
  modalOpen.value = true;
  void refreshPorts();
}

function closeSettings(): void {
  modalOpen.value = false;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && modalOpen.value) closeSettings();
}

function applySettings(): void {
  try {
    buildConfig(draft.value);
    settings.value = cloneTransportSettings(draft.value);
    saveTransportSettings(settings.value, props.profileId);
    closeSettings();
  } catch (error) {
    emit("error", error instanceof Error ? error.message : "通信配置无效");
  }
}

async function connect(): Promise<void> {
  busy.value = true;
  try {
    const config = buildConfig(settings.value);
    saveTransportSettings(settings.value, props.profileId);
    const status = await apiRequest<TransportStatus>("/api/connect", {
      method: "POST",
      body: JSON.stringify(config),
    });
    emit("status", status);
  } catch (error) {
    emit("error", error instanceof Error ? error.message : "连接失败");
  } finally {
    busy.value = false;
  }
}

async function disconnect(): Promise<void> {
  busy.value = true;
  try {
    await apiRequest<{ ok: boolean; message: string }>("/api/disconnect", {
      method: "POST",
      body: "{}",
    });
    emit("status", await apiRequest<TransportStatus>("/api/status"));
  } catch (error) {
    emit("error", error instanceof Error ? error.message : "断开失败");
  } finally {
    busy.value = false;
  }
}

async function refreshPorts(): Promise<void> {
  refreshingPorts.value = true;
  try {
    serialPorts.value = await apiRequest<SerialPortInfo[]>("/api/serial/ports");
  } catch (error) {
    emit("error", error instanceof Error ? error.message : "串口列表刷新失败");
  } finally {
    refreshingPorts.value = false;
  }
}

function buildConfig(source: TransportSettings): TransportConfig {
  if (source.mode === "serial") {
    if (!source.serial.port.trim()) throw new Error("请选择要打开的串口设备");
    return { ...source.serial, port: source.serial.port.trim() };
  }
  if (source.mode === "tcp_client") {
    if (!source.tcpClient.host.trim()) throw new Error("请填写 TCP 远端地址");
    return { ...source.tcpClient, host: source.tcpClient.host.trim() };
  }
  if (source.mode === "tcp_server") {
    if (!source.tcpServer.host.trim()) throw new Error("请填写 TCP 监听地址");
    return { ...source.tcpServer, host: source.tcpServer.host.trim() };
  }

  const remoteHost = source.udp.remote_host?.trim() || null;
  const remotePort = source.udp.remote_port || null;
  if ((remoteHost === null) !== (remotePort === null)) {
    throw new Error("UDP 远端地址和端口必须同时填写或同时留空");
  }
  return {
    ...source.udp,
    local_host: source.udp.local_host.trim(),
    remote_host: remoteHost,
    remote_port: remotePort,
  };
}

function summarizeConfig(source: TransportSettings): string {
  if (source.mode === "serial") {
    const value = source.serial;
    const parity = { N: "N", E: "E", O: "O", M: "M", S: "S" }[value.parity];
    return `${value.port || "未选择串口"} · ${value.baudrate} · ${value.bytesize}${parity}${value.stopbits} · 合并 ${value.receive_idle_ms} ms`;
  }
  if (source.mode === "tcp_client") {
    return `${source.tcpClient.host}:${source.tcpClient.port}${source.tcpClient.auto_reconnect ? " · 自动重连" : ""}`;
  }
  if (source.mode === "tcp_server") return `${source.tcpServer.host}:${source.tcpServer.port} · 广播`;
  const remote = source.udp.remote_host && source.udp.remote_port
    ? ` → ${source.udp.remote_host}:${source.udp.remote_port}`
    : " · 回复最近来源";
  return `${source.udp.local_host}:${source.udp.local_port}${remote}`;
}

function summarizeStatus(status: TransportStatus): string {
  const details = status.details;
  if (status.mode === "serial") {
    return `${String(details.port)} · ${Number(details.baudrate)} · ${Number(details.bytesize)}${String(details.parity)}${Number(details.stopbits)} · 合并 ${Number(details.receive_idle_ms)} ms`;
  }
  if (status.mode === "tcp_client") {
    return `${String(details.host)}:${Number(details.port)}${details.reconnecting === true ? " · 重连中" : details.auto_reconnect === true ? " · 自动重连" : ""}`;
  }
  if (status.mode === "tcp_server") {
    return `${String(details.host)}:${Number(details.port)} · ${Number(details.client_count ?? 0)} 个客户端`;
  }
  if (status.mode === "udp") {
    const remote = details.remote ? ` → ${String(details.remote)}` : " · 回复最近来源";
    return `${String(details.local_host)}:${Number(details.local_port)}${remote}`;
  }
  return summarizeConfig(settings.value);
}

function portLabel(port: SerialPortInfo): string {
  return port.description && port.description !== "n/a"
    ? `${port.device} - ${port.description}`
    : port.device;
}

function hasDetectedPort(device: string): boolean {
  return serialPorts.value.some((port) => port.device === device);
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  void refreshPorts();
});

onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <section class="transport-bar" aria-label="当前通信设置">
    <div class="transport-summary">
      <span class="transport-mode">{{ modeLabel }}</span>
      <span class="transport-description" :title="summary">{{ summary }}</span>
    </div>

    <div class="transport-actions">
      <span class="channel-state" :class="{ online: eventsConnected }" :title="eventsConnected ? '实时通道已连接' : '实时通道正在重连'">
        <span></span>{{ eventsConnected ? "实时" : "重连中" }}
      </span>
      <span class="metric"><small>RX</small><strong>{{ status.rx_bytes.toLocaleString() }} B</strong></span>
      <span class="metric"><small>TX</small><strong>{{ status.tx_bytes.toLocaleString() }} B</strong></span>
      <button class="bar-icon-button" type="button" title="配置通信设置" aria-label="配置通信设置" @click="openSettings">
        <Settings :size="18" />
      </button>
      <button v-if="!sessionActive" class="bar-command connect" type="button" :disabled="busy" @click="connect">
        <Link :size="16" /><span>连接</span>
      </button>
      <button v-else class="bar-command disconnect" type="button" :disabled="busy" @click="disconnect">
        <Power :size="16" /><span>{{ reconnecting ? "停止重连" : "断开" }}</span>
      </button>
    </div>
  </section>

  <Teleport to="body">
    <div v-if="modalOpen" class="modal-backdrop" @mousedown.self="closeSettings">
      <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="dialog-header">
          <div>
            <span class="eyebrow">TRANSPORT</span>
            <h2 id="settings-title">通信设置</h2>
          </div>
          <button class="bar-icon-button" type="button" title="关闭" aria-label="关闭通信设置" @click="closeSettings">
            <X :size="18" />
          </button>
        </header>

        <div class="dialog-body">
          <div class="dialog-mode-tabs" role="tablist" aria-label="通信模式">
            <button
              v-for="item in modes"
              :key="item.value"
              class="mode-tab"
              :class="{ active: draft.mode === item.value }"
              :disabled="sessionActive"
              type="button"
              @click="draft.mode = item.value"
            >
              {{ item.label }}
            </button>
          </div>

          <fieldset :disabled="sessionActive" class="settings-fields">
            <div v-if="draft.mode === 'serial'" class="dialog-grid">
              <label class="field span-2">
                <span>串口设备</span>
                <span class="input-row">
                  <select v-model="draft.serial.port">
                    <option value="">请选择串口</option>
                    <option v-if="draft.serial.port && !hasDetectedPort(draft.serial.port)" :value="draft.serial.port">
                      {{ draft.serial.port }} - 当前未检测到
                    </option>
                    <option v-for="port in serialPorts" :key="port.device" :value="port.device">{{ portLabel(port) }}</option>
                  </select>
                  <button class="icon-button" type="button" title="刷新串口列表" aria-label="刷新串口列表" :disabled="refreshingPorts" @click="refreshPorts">
                    <RefreshCw :size="17" :class="{ spinning: refreshingPorts }" />
                  </button>
                </span>
              </label>
              <label class="field"><span>波特率</span><select v-model="draft.serial.baudrate"><option v-for="rate in [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]" :key="rate" :value="rate">{{ rate }}</option></select></label>
              <label class="field"><span>数据位</span><select v-model="draft.serial.bytesize"><option v-for="size in ([5, 6, 7, 8] as const)" :key="size" :value="size">{{ size }}</option></select></label>
              <label class="field"><span>校验位</span><select v-model="draft.serial.parity"><option value="N">无校验</option><option value="E">偶校验</option><option value="O">奇校验</option><option value="M">Mark</option><option value="S">Space</option></select></label>
              <label class="field"><span>停止位</span><select v-model="draft.serial.stopbits"><option :value="1">1</option><option :value="1.5">1.5</option><option :value="2">2</option></select></label>
              <label class="field span-2"><span>接收合并间隔 (ms)</span><input v-model.number="draft.serial.receive_idle_ms" type="number" min="1" max="1000" required /><small>线路持续空闲达到该时间后，显示为一条 RX 记录。</small></label>
            </div>

            <div v-else-if="draft.mode === 'tcp_client'" class="dialog-grid">
              <label class="field"><span>远端地址</span><input v-model.trim="draft.tcpClient.host" required /></label>
              <label class="field"><span>远端端口</span><input v-model.number="draft.tcpClient.port" type="number" min="1" max="65535" required /></label>
              <label class="field span-2"><span>连接超时 (秒)</span><input v-model.number="draft.tcpClient.connect_timeout" type="number" min="0.1" max="60" step="0.1" required /></label>
              <label class="settings-toggle span-2">
                <input v-model="draft.tcpClient.auto_reconnect" type="checkbox" />
                <span>掉线自动重连</span>
              </label>
            </div>

            <div v-else-if="draft.mode === 'tcp_server'" class="dialog-grid">
              <label class="field"><span>监听地址</span><input v-model.trim="draft.tcpServer.host" required /></label>
              <label class="field"><span>监听端口</span><input v-model.number="draft.tcpServer.port" type="number" min="0" max="65535" required /></label>
            </div>

            <div v-else class="dialog-grid">
              <label class="field"><span>本地地址</span><input v-model.trim="draft.udp.local_host" required /></label>
              <label class="field"><span>本地端口</span><input v-model.number="draft.udp.local_port" type="number" min="0" max="65535" required /></label>
              <label class="field"><span>远端地址</span><input v-model.trim="draft.udp.remote_host" placeholder="可留空" /></label>
              <label class="field"><span>远端端口</span><input v-model.number="draft.udp.remote_port" type="number" min="1" max="65535" placeholder="可留空" /></label>
            </div>
          </fieldset>

          <p v-if="sessionActive" class="dialog-notice">{{ reconnecting ? "正在自动重连，停止重连后才能修改设置。" : "通信已连接，断开后才能修改设置。" }}</p>
        </div>

        <footer class="dialog-footer">
          <button class="dialog-button secondary" type="button" @click="closeSettings">取消</button>
          <button class="dialog-button primary" type="button" :disabled="sessionActive" @click="applySettings">应用设置</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
