<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Eraser, PanelRight, Pause, Play, Repeat, Send, Square } from "@lucide/vue";
import { apiRequest } from "../api";
import {
  loadSendEditor,
  loadSendPresets,
  MAX_SEND_PRESETS,
  saveSendEditor,
  saveSendPresets,
} from "../storage";
import type {
  DataFormat,
  LineEnding,
  LogItem,
  PeriodicSendRequest,
  PeriodicSendStatus,
  SendPayload,
  SendPreset,
  SendPresetDraft,
  TextEncoding,
} from "../types";
import SendPresetPanel from "./SendPresetPanel.vue";
import VirtualLog from "./VirtualLog.vue";

const props = defineProps<{
  connected: boolean;
  logs: LogItem[];
  paused: boolean;
  periodicStatus: PeriodicSendStatus;
}>();

const emit = defineEmits<{
  error: [message: string];
  clear: [];
  "update:paused": [paused: boolean];
  "periodic-status": [status: PeriodicSendStatus];
}>();

const displayHex = ref(false);
const autoScroll = ref(true);
const storedEditor = loadSendEditor();
const format = ref<DataFormat>(storedEditor.format);
const textEncoding = ref<TextEncoding>(storedEditor.text_encoding);
const lineEnding = ref<LineEnding>(storedEditor.line_ending);
const sendData = ref(storedEditor.data);
const intervalMs = ref(storedEditor.interval_ms);
const sending = ref(false);
const changingPeriodic = ref(false);
const presets = ref<SendPreset[]>(loadSendPresets());
const presetsOpen = ref(true);
const sendingPresetId = ref<string | null>(null);
const sequenceRunning = ref(false);
let sequenceGeneration = 0;
let editorSaveTimer: number | undefined;
let presetSaveTimer: number | undefined;
const placeholder = computed(() => format.value === "hex" ? "AA 55 01 00" : "输入发送内容");
const editorPayload = computed<SendPayload>(() => ({
  data: sendData.value,
  format: format.value,
  text_encoding: textEncoding.value,
  line_ending: lineEnding.value,
}));

watch(format, (value) => {
  if (value === "hex") displayHex.value = true;
});
watch([sendData, format, textEncoding, lineEnding, intervalMs], scheduleEditorSave);
watch(() => props.periodicStatus.interval_ms, (value) => {
  if (value !== null) intervalMs.value = value;
});
onMounted(() => window.addEventListener("beforeunload", persistPendingState));
onBeforeUnmount(() => {
  sequenceGeneration += 1;
  window.removeEventListener("beforeunload", persistPendingState);
  persistPendingState();
  if (editorSaveTimer !== undefined) window.clearTimeout(editorSaveTimer);
  if (presetSaveTimer !== undefined) window.clearTimeout(presetSaveTimer);
});

async function sendPayload(payload: SendPayload): Promise<void> {
  await apiRequest<{ ok: boolean; message: string }>("/api/send", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function send(): Promise<void> {
  sending.value = true;
  try {
    await sendPayload(editorPayload.value);
  } catch (error) {
    emitError(error, "发送失败");
  } finally {
    sending.value = false;
  }
}

async function togglePeriodic(): Promise<void> {
  changingPeriodic.value = true;
  try {
    if (props.periodicStatus.active) {
      const response = await apiRequest<{ status: PeriodicSendStatus }>("/api/periodic-send/stop", {
        method: "POST",
      });
      emit("periodic-status", response.status);
      return;
    }
    const payload: PeriodicSendRequest = {
      ...editorPayload.value,
      interval_ms: intervalMs.value,
    };
    const status = await apiRequest<PeriodicSendStatus>("/api/periodic-send/start", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    emit("periodic-status", status);
  } catch (error) {
    emitError(error, props.periodicStatus.active ? "停止周期发送失败" : "启动周期发送失败");
  } finally {
    changingPeriodic.value = false;
  }
}

function handleSendShortcut(event: KeyboardEvent): void {
  if (event.key !== "Enter" || !event.ctrlKey) return;
  event.preventDefault();
  if (props.connected && !sending.value) void send();
}

function loadPreset(preset: SendPreset): void {
  sendData.value = preset.data;
  format.value = preset.format;
  textEncoding.value = preset.text_encoding;
  lineEnding.value = preset.line_ending;
}

async function sendPreset(preset: SendPreset): Promise<void> {
  sendingPresetId.value = preset.id;
  try {
    await sendPayload(preset);
  } catch (error) {
    emitError(error, "预设发送失败");
  } finally {
    sendingPresetId.value = null;
  }
}

function addPreset(): void {
  if (presets.value.length >= MAX_SEND_PRESETS) {
    emit("error", `发送预设最多保存 ${MAX_SEND_PRESETS} 条`);
    return;
  }
  const now = new Date().toISOString();
  presets.value.push({
    id: createPresetId(),
    name: "",
    data: "",
    format: "text",
    text_encoding: "utf-8",
    line_ending: "none",
    enabled: true,
    delay_ms: 50,
    updated_at: now,
  });
  schedulePresetSave();
}

function updatePreset(id: string, changes: Partial<SendPresetDraft>): void {
  const now = new Date().toISOString();
  const index = presets.value.findIndex((preset) => preset.id === id);
  if (index < 0) return;
  const preset = presets.value[index]!;
  presets.value.splice(index, 1, { ...preset, ...changes, updated_at: now });
  schedulePresetSave();
}

function removePreset(preset: SendPreset): void {
  presets.value = presets.value.filter((item) => item.id !== preset.id);
  schedulePresetSave();
}

async function toggleSequence(): Promise<void> {
  if (sequenceRunning.value) {
    sequenceGeneration += 1;
    sequenceRunning.value = false;
    sendingPresetId.value = null;
    return;
  }
  const queue = presets.value.filter((preset) => preset.enabled && preset.data.length > 0);
  if (!props.connected || queue.length === 0) return;
  const generation = ++sequenceGeneration;
  sequenceRunning.value = true;
  try {
    for (const [index, preset] of queue.entries()) {
      if (generation !== sequenceGeneration) break;
      sendingPresetId.value = preset.id;
      await sendPayload(preset);
      if (generation !== sequenceGeneration) break;
      if (index < queue.length - 1 && preset.delay_ms > 0) {
        await sequenceDelay(preset.delay_ms, generation);
      }
    }
  } catch (error) {
    emitError(error, "预设队列发送失败");
  } finally {
    if (generation === sequenceGeneration) {
      sequenceRunning.value = false;
      sendingPresetId.value = null;
    }
  }
}

function sequenceDelay(delayMs: number, generation: number): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = (): void => {
      if (generation !== sequenceGeneration || Date.now() - startedAt >= delayMs) {
        resolve();
        return;
      }
      window.setTimeout(poll, Math.min(50, delayMs));
    };
    poll();
  });
}

function scheduleEditorSave(): void {
  if (editorSaveTimer !== undefined) window.clearTimeout(editorSaveTimer);
  editorSaveTimer = window.setTimeout(persistEditor, 180);
}

function persistEditor(): void {
  try {
    saveSendEditor({
      version: 1,
      ...editorPayload.value,
      interval_ms: intervalMs.value,
    });
  } catch {
    emit("error", "发送区内容保存失败，请检查浏览器本地存储空间");
  }
}

function schedulePresetSave(): void {
  if (presetSaveTimer !== undefined) window.clearTimeout(presetSaveTimer);
  presetSaveTimer = window.setTimeout(persistPresets, 180);
}

function persistPresets(): void {
  try {
    saveSendPresets(presets.value);
  } catch {
    emit("error", "发送预设保存失败，请检查浏览器本地存储空间");
  }
}

function persistPendingState(): void {
  persistEditor();
  persistPresets();
}

function createPresetId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emitError(error: unknown, fallback: string): void {
  emit("error", error instanceof Error ? error.message : fallback);
}
</script>

<template>
  <section class="console-area">
    <div class="console-toolbar">
      <div>
        <span class="eyebrow">LIVE TRAFFIC</span>
        <h2>通信日志</h2>
      </div>
      <div class="toolbar-actions">
        <label class="toggle">
          <input v-model="displayHex" type="checkbox" />
          <span>HEX 显示</span>
        </label>
        <label class="toggle">
          <input v-model="autoScroll" type="checkbox" />
          <span>自动滚动</span>
        </label>
        <button
          class="icon-tool-button"
          :class="{ active: presetsOpen }"
          type="button"
          :title="presetsOpen ? '关闭发送预设' : '打开发送预设'"
          :aria-label="presetsOpen ? '关闭发送预设' : '打开发送预设'"
          @click="presetsOpen = !presetsOpen"
        >
          <PanelRight :size="16" />
        </button>
        <button
          class="icon-tool-button"
          type="button"
          :title="paused ? '继续显示' : '暂停显示'"
          :aria-label="paused ? '继续显示' : '暂停显示'"
          @click="emit('update:paused', !paused)"
        >
          <Play v-if="paused" :size="16" />
          <Pause v-else :size="16" />
        </button>
        <button class="icon-tool-button" type="button" title="清空日志" aria-label="清空日志" @click="emit('clear')">
          <Eraser :size="16" />
        </button>
      </div>
    </div>

    <div class="traffic-workspace" :class="{ 'presets-open': presetsOpen }">
      <VirtualLog :logs="logs" :display-hex="displayHex" :auto-scroll="autoScroll" />
      <SendPresetPanel
        :presets="presets"
        :connected="connected"
        :open="presetsOpen"
        :editor-locked="periodicStatus.active"
        :sending-preset-id="sendingPresetId"
        :sequence-running="sequenceRunning"
        @close="presetsOpen = false"
        @add="addPreset"
        @update="updatePreset"
        @remove="removePreset"
        @load="loadPreset"
        @send="sendPreset"
        @toggle-sequence="toggleSequence"
      />
    </div>

    <form class="send-panel" @submit.prevent="send">
      <div class="send-options">
        <div class="segmented" aria-label="发送格式">
          <label><input v-model="format" type="radio" value="text" :disabled="periodicStatus.active" /><span>文本</span></label>
          <label><input v-model="format" type="radio" value="hex" :disabled="periodicStatus.active" /><span>HEX</span></label>
        </div>
        <label class="compact-field">
          <span>编码</span>
          <select v-model="textEncoding" :disabled="format === 'hex' || periodicStatus.active">
            <option value="utf-8">UTF-8</option>
            <option value="ascii">ASCII</option>
            <option value="gbk">GBK</option>
          </select>
        </label>
        <label class="compact-field">
          <span>行尾</span>
          <select v-model="lineEnding" :disabled="periodicStatus.active">
            <option value="none">无</option>
            <option value="crlf">CRLF</option>
            <option value="lf">LF</option>
            <option value="cr">CR</option>
          </select>
        </label>
        <div class="periodic-controls" :class="{ active: periodicStatus.active }">
          <Repeat :size="15" />
          <label>
            <span>周期</span>
            <input v-model.number="intervalMs" type="number" min="10" max="86400000" step="10" :disabled="periodicStatus.active" />
            <span>ms</span>
          </label>
          <span v-if="periodicStatus.active" class="periodic-count">已发送 {{ periodicStatus.sent_count }} 次</span>
          <button
            class="periodic-button"
            :class="{ stop: periodicStatus.active }"
            type="button"
            :disabled="changingPeriodic || (!periodicStatus.active && (!connected || !sendData.length || intervalMs < 10 || intervalMs > 86400000))"
            @click="togglePeriodic"
          >
            <Square v-if="periodicStatus.active" :size="13" />
            <Play v-else :size="14" />
            <span>{{ periodicStatus.active ? "停止" : "启动" }}</span>
          </button>
        </div>
      </div>
      <div class="send-row">
        <textarea
          v-model="sendData"
          rows="3"
          maxlength="1048576"
          :placeholder="placeholder"
          :disabled="periodicStatus.active"
          @keydown="handleSendShortcut"
        ></textarea>
        <button class="button button-send" type="submit" :disabled="sending || !connected || !sendData.length">
          <Send :size="17" />
          <span>发送</span>
        </button>
      </div>
    </form>
  </section>
</template>
