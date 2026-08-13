<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Eraser, PanelRight, Pause, Play, Repeat, Send, Settings, Square } from "@lucide/vue";
import { apiRequest } from "../api";
import {
  compactHexDisplay,
  deleteAcrossHexDisplaySpace,
  formatHexDisplay,
  hexDisplayCaret,
  MAX_HEX_DISPLAY_LENGTH,
} from "../hex-display";
import {
  loadSendEditor,
  loadHexFrameConfig,
  loadSendPresets,
  MAX_SEND_PRESETS,
  saveSendEditor,
  saveHexFrameConfig,
  saveSendPresets,
} from "../storage";
import type {
  DataFormat,
  HexFrameConfig,
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
import HexFrameBuilder from "./HexFrameBuilder.vue";
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
const frameConfig = ref<HexFrameConfig>(loadHexFrameConfig());
const frameBuilderOpen = ref(false);
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
const displayedSendData = computed(() => (
  format.value === "hex" ? formatHexDisplay(sendData.value) : sendData.value
));
const sendDataMaxlength = computed(() => (
  format.value === "hex" ? MAX_HEX_DISPLAY_LENGTH : 1_048_576
));
const editorPayload = computed<SendPayload>(() => ({
  data: sendData.value,
  format: format.value,
  text_encoding: textEncoding.value,
  line_ending: lineEnding.value,
  ...(format.value === "hex" && frameConfig.value.enabled
    ? { frame_config: frameConfig.value }
    : {}),
}));
const hasIndependentFramePayload = computed(() => frameConfig.value.enabled && frameConfig.value.fields.some((field) => {
  if (field.kind === "sequence" || field.kind === "length" || field.kind === "checksum") return true;
  if (field.kind === "data" && field.source === "editor") return false;
  return field.value.trim().length > 0;
}));
const canSendEditor = computed(() => sendData.value.length > 0 || (format.value === "hex" && hasIndependentFramePayload.value));

watch(format, (value) => {
  if (value === "hex") displayHex.value = true;
});
watch([sendData, format, textEncoding, lineEnding, intervalMs], scheduleEditorSave);
watch(() => props.periodicStatus.interval_ms, (value) => {
  if (value !== null) intervalMs.value = value;
});
watch(() => props.periodicStatus.frame_sequences, applyFrameSequences, { deep: true });
onMounted(() => window.addEventListener("beforeunload", persistPendingState));
onBeforeUnmount(() => {
  sequenceGeneration += 1;
  window.removeEventListener("beforeunload", persistPendingState);
  persistPendingState();
  if (editorSaveTimer !== undefined) window.clearTimeout(editorSaveTimer);
  if (presetSaveTimer !== undefined) window.clearTimeout(presetSaveTimer);
});

async function sendPayload(payload: SendPayload): Promise<void> {
  const request: SendPayload = payload.format === "hex" && frameConfig.value.enabled
    ? { ...payload, frame_config: frameConfig.value }
    : payload;
  const response = await apiRequest<{
    ok: boolean;
    message: string;
    frame_sequences: Record<string, string> | null;
  }>("/api/send", {
    method: "POST",
    body: JSON.stringify(request),
  });
  applyFrameSequences(response.frame_sequences);
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
  if (props.connected && !sending.value && canSendEditor.value) void send();
}

function handleSendEditorKeydown(event: KeyboardEvent): void {
  handleSendShortcut(event);
  if (event.defaultPrevented || format.value !== "hex") return;
  if (event.key !== "Backspace" && event.key !== "Delete") return;

  const target = event.target as HTMLTextAreaElement;
  if (target.selectionStart !== target.selectionEnd) return;
  const edit = deleteAcrossHexDisplaySpace(
    target.value,
    target.selectionStart,
    event.key === "Backspace" ? "backward" : "forward",
  );
  if (!edit) return;

  event.preventDefault();
  sendData.value = edit.value;
  target.value = formatHexDisplay(edit.value);
  target.setSelectionRange(edit.caret, edit.caret);
}

function updateSendData(event: Event): void {
  const target = event.target as HTMLTextAreaElement;
  if (format.value !== "hex") {
    sendData.value = target.value;
    return;
  }

  const rawOffset = compactHexDisplay(target.value.slice(0, target.selectionStart)).length;
  const compactValue = compactHexDisplay(target.value);
  target.value = formatHexDisplay(compactValue);
  sendData.value = compactValue;
  const caret = hexDisplayCaret(rawOffset, compactValue.length);
  target.setSelectionRange(caret, caret);
}

function loadPreset(preset: SendPreset): void {
  sendData.value = preset.data;
  format.value = preset.format;
  textEncoding.value = preset.text_encoding;
  lineEnding.value = preset.line_ending;
}

function openFrameBuilder(): void {
  format.value = "hex";
  frameBuilderOpen.value = true;
}

function applyFrameConfig(config: HexFrameConfig): void {
  frameConfig.value = config;
  try {
    saveHexFrameConfig(config);
  } catch {
    emit("error", "HEX 帧配置保存失败，请检查浏览器本地存储空间");
  }
}

function canSendPreset(preset: SendPreset): boolean {
  return preset.data.length > 0 || (preset.format === "hex" && hasIndependentFramePayload.value);
}

function applyFrameSequences(sequences: Record<string, string> | null): void {
  if (!sequences) return;
  let changed = false;
  const fields = frameConfig.value.fields.map((field) => {
    if (field.kind !== "sequence" || sequences[field.id] === undefined) return field;
    changed = true;
    return { ...field, value: sequences[field.id]! };
  });
  if (!changed) return;
  applyFrameConfig({ ...frameConfig.value, fields });
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
  const queue = presets.value.filter((preset) => preset.enabled && canSendPreset(preset));
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
        :allow-empty-hex-frame="hasIndependentFramePayload"
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
        <button
          class="frame-config-button"
          :class="{ active: frameConfig.enabled }"
          type="button"
          :disabled="periodicStatus.active"
          @click="openFrameBuilder"
        >
          <Settings :size="14" />
          <span>{{ frameConfig.enabled ? `编辑 HEX 帧 · ${frameConfig.fields.length} 字段` : "编辑 HEX 帧" }}</span>
        </button>
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
            :disabled="changingPeriodic || (!periodicStatus.active && (!connected || !canSendEditor || intervalMs < 10 || intervalMs > 86400000))"
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
          :value="displayedSendData"
          rows="3"
          :maxlength="sendDataMaxlength"
          :placeholder="placeholder"
          :disabled="periodicStatus.active"
          @input="updateSendData"
          @keydown="handleSendEditorKeydown"
        ></textarea>
        <button class="button button-send" type="submit" :disabled="sending || !connected || !canSendEditor">
          <Send :size="17" />
          <span>发送</span>
        </button>
      </div>
    </form>
    <HexFrameBuilder
      v-model:open="frameBuilderOpen"
      :config="frameConfig"
      :editor-data="sendData"
      @apply="applyFrameConfig"
      @error="emit('error', $event)"
    />
  </section>
</template>
