<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { Link, Power, RefreshCw } from "@lucide/vue";
import { apiRequest } from "../api";
import type {
  SerialConfig,
  SerialPortInfo,
  TcpClientConfig,
  TcpServerConfig,
  TransportConfig,
  TransportMode,
  TransportStatus,
  UdpConfig,
} from "../types";

const props = defineProps<{
  status: TransportStatus;
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

const mode = ref<TransportMode>("serial");
const busy = ref(false);
const refreshingPorts = ref(false);
const serialPorts = ref<SerialPortInfo[]>([]);

const serial = reactive<SerialConfig>({
  mode: "serial",
  port: "",
  baudrate: 115200,
  bytesize: 8,
  parity: "N",
  stopbits: 1,
});
const tcpClient = reactive<TcpClientConfig>({
  mode: "tcp_client",
  host: "127.0.0.1",
  port: 9000,
  connect_timeout: 8,
});
const tcpServer = reactive<TcpServerConfig>({
  mode: "tcp_server",
  host: "0.0.0.0",
  port: 9000,
});
const udp = reactive<UdpConfig>({
  mode: "udp",
  local_host: "0.0.0.0",
  local_port: 9000,
  remote_host: null,
  remote_port: null,
});

const connected = computed(() => props.status.connected);

watch(
  () => props.status,
  (status) => {
    if (status.connected && status.mode) mode.value = status.mode;
  },
  { immediate: true },
);

function activeConfig(): TransportConfig {
  if (mode.value === "serial") {
    if (!serial.port) throw new Error("请选择要打开的串口设备");
    return { ...serial };
  }
  if (mode.value === "tcp_client") return { ...tcpClient };
  if (mode.value === "tcp_server") return { ...tcpServer };

  const remoteHost = udp.remote_host?.trim() || null;
  const remotePort = udp.remote_port || null;
  if ((remoteHost === null) !== (remotePort === null)) {
    throw new Error("UDP 远端地址和端口必须同时填写或同时留空");
  }
  return { ...udp, remote_host: remoteHost, remote_port: remotePort };
}

async function refreshPorts(): Promise<void> {
  refreshingPorts.value = true;
  try {
    const current = serial.port;
    serialPorts.value = await apiRequest<SerialPortInfo[]>("/api/serial/ports");
    if (serialPorts.value.some((port) => port.device === current)) return;
    serial.port = serialPorts.value.length === 1 ? serialPorts.value[0]!.device : "";
  } catch (error) {
    emit("error", error instanceof Error ? error.message : "串口列表刷新失败");
  } finally {
    refreshingPorts.value = false;
  }
}

async function connect(): Promise<void> {
  busy.value = true;
  try {
    const status = await apiRequest<TransportStatus>("/api/connect", {
      method: "POST",
      body: JSON.stringify(activeConfig()),
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
    const status = await apiRequest<TransportStatus>("/api/status");
    emit("status", status);
  } catch (error) {
    emit("error", error instanceof Error ? error.message : "断开失败");
  } finally {
    busy.value = false;
  }
}

function portLabel(port: SerialPortInfo): string {
  return port.description && port.description !== "n/a"
    ? `${port.device} - ${port.description}`
    : port.device;
}

onMounted(refreshPorts);
</script>

<template>
  <aside class="sidebar">
    <section class="config-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">TRANSPORT</span>
          <h2>连接配置</h2>
        </div>
      </div>

      <div class="mode-tabs" role="tablist" aria-label="通信模式">
        <button
          v-for="item in modes"
          :key="item.value"
          class="mode-tab"
          :class="{ active: mode === item.value }"
          :disabled="connected"
          type="button"
          @click="mode = item.value"
        >
          {{ item.label }}
        </button>
      </div>

      <form @submit.prevent="connect">
        <div v-if="mode === 'serial'" class="mode-panel">
          <label class="field field-wide">
            <span>串口设备</span>
            <span class="input-row">
              <select v-model="serial.port" :disabled="connected">
                <option value="">{{ serialPorts.length ? "请选择串口" : "未发现串口" }}</option>
                <option v-for="port in serialPorts" :key="port.device" :value="port.device">
                  {{ portLabel(port) }}
                </option>
              </select>
              <button
                class="icon-button"
                type="button"
                title="刷新串口列表"
                aria-label="刷新串口列表"
                :disabled="connected || refreshingPorts"
                @click="refreshPorts"
              >
                <RefreshCw :size="17" :class="{ spinning: refreshingPorts }" />
              </button>
            </span>
          </label>
          <div class="field-grid">
            <label class="field">
              <span>波特率</span>
              <select v-model="serial.baudrate" :disabled="connected">
                <option v-for="rate in [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]" :key="rate" :value="rate">{{ rate }}</option>
              </select>
            </label>
            <label class="field">
              <span>数据位</span>
              <select v-model="serial.bytesize" :disabled="connected">
                <option v-for="size in ([5, 6, 7, 8] as const)" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
            <label class="field">
              <span>校验位</span>
              <select v-model="serial.parity" :disabled="connected">
                <option value="N">无校验</option>
                <option value="E">偶校验</option>
                <option value="O">奇校验</option>
                <option value="M">Mark</option>
                <option value="S">Space</option>
              </select>
            </label>
            <label class="field">
              <span>停止位</span>
              <select v-model="serial.stopbits" :disabled="connected">
                <option :value="1">1</option>
                <option :value="1.5">1.5</option>
                <option :value="2">2</option>
              </select>
            </label>
          </div>
        </div>

        <div v-else-if="mode === 'tcp_client'" class="mode-panel">
          <label class="field">
            <span>远端地址</span>
            <input v-model.trim="tcpClient.host" :disabled="connected" placeholder="192.168.1.10" required />
          </label>
          <label class="field">
            <span>远端端口</span>
            <input v-model.number="tcpClient.port" :disabled="connected" type="number" min="1" max="65535" required />
          </label>
        </div>

        <div v-else-if="mode === 'tcp_server'" class="mode-panel">
          <label class="field">
            <span>监听地址</span>
            <input v-model.trim="tcpServer.host" :disabled="connected" required />
          </label>
          <label class="field">
            <span>监听端口</span>
            <input v-model.number="tcpServer.port" :disabled="connected" type="number" min="0" max="65535" required />
          </label>
          <div class="behavior-badge">广播模式</div>
        </div>

        <div v-else class="mode-panel">
          <div class="field-grid">
            <label class="field">
              <span>本地地址</span>
              <input v-model.trim="udp.local_host" :disabled="connected" required />
            </label>
            <label class="field">
              <span>本地端口</span>
              <input v-model.number="udp.local_port" :disabled="connected" type="number" min="0" max="65535" required />
            </label>
          </div>
          <div class="field-grid">
            <label class="field">
              <span>远端地址</span>
              <input v-model.trim="udp.remote_host" :disabled="connected" placeholder="可留空" />
            </label>
            <label class="field">
              <span>远端端口</span>
              <input v-model.number="udp.remote_port" :disabled="connected" type="number" min="1" max="65535" placeholder="可留空" />
            </label>
          </div>
        </div>

        <div class="connection-actions">
          <button class="button button-primary" type="submit" :disabled="busy || connected">
            <Link :size="16" />
            <span>建立连接</span>
          </button>
          <button class="button button-secondary" type="button" :disabled="busy || !connected" @click="disconnect">
            <Power :size="16" />
            <span>断开</span>
          </button>
        </div>
      </form>
    </section>

    <section class="stats-section">
      <div class="stat">
        <span>接收</span>
        <strong>{{ status.rx_bytes.toLocaleString() }} B</strong>
      </div>
      <div class="stat">
        <span>发送</span>
        <strong>{{ status.tx_bytes.toLocaleString() }} B</strong>
      </div>
    </section>
  </aside>
</template>
