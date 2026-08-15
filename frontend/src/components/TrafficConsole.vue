<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Eraser, ExternalLink, Gauge, List, PanelRight, Pause, Play, Repeat, Send, Settings, Square, X } from "@lucide/vue";
import { apiRequest } from "../api";
import {
  compactHexDisplay,
  deleteAcrossHexDisplaySpace,
  formatHexDisplay,
  hexDisplayCaret,
  MAX_HEX_DISPLAY_LENGTH,
} from "../hex-display";
import {
  cloneSendPreset,
  DEFAULT_LAYOUT_PREFERENCES,
  DEFAULT_HEX_FRAME_CONFIG,
  hexFrameStorageKey,
  LAYOUT_PREFERENCES_KEY,
  loadLayoutPreferences,
  loadSendEditor,
  loadHexFrameConfig,
  loadSendPresets,
  MAX_SEND_PRESETS,
  saveSendEditor,
  saveHexFrameConfig,
  saveLayoutPreferences,
  saveSendPresets,
  sendEditorStorageKey,
  sendPresetsStorageKey,
} from "../storage";
import type {
  DataFormat,
  HexFrameConfig,
  LineEnding,
  LogItem,
  PeriodicSendRequest,
  PeriodicSendStatus,
  ReceivedFrame,
  SendPayload,
  SendPreset,
  SendPresetDraft,
  TextEncoding,
} from "../types";
import SendPresetPanel from "./SendPresetPanel.vue";
import HexFrameBuilder from "./HexFrameBuilder.vue";
import FrameGeneratedControls from "./FrameGeneratedControls.vue";
import FrameAnalyzer from "./FrameAnalyzer.vue";
import VirtualLog from "./VirtualLog.vue";

const props = defineProps<{
  profileId: string;
  connected: boolean;
  logs: LogItem[];
  receivedFrames: ReceivedFrame[];
  paused: boolean;
  periodicStatus: PeriodicSendStatus;
  toolOnly?: "presets";
}>();

const emit = defineEmits<{
  error: [message: string];
  clear: [];
  "update:paused": [paused: boolean];
  "periodic-status": [status: PeriodicSendStatus];
  "close-tool": [];
}>();

const displayHex = ref(false);
const autoScroll = ref(true);
const showTransmitLogs = ref(true);
const frameAnalyzer = ref<InstanceType<typeof FrameAnalyzer> | null>(null);
const visibleLogs = computed(() => (
  showTransmitLogs.value ? props.logs : props.logs.filter((log) => log.kind !== "tx")
));
type WorkspaceTool = "presets" | "dashboard" | "parser";
const TOOL_ORDER: WorkspaceTool[] = ["presets", "dashboard", "parser"];
const activeTool = ref<WorkspaceTool>("presets");
const analyzerView = ref<"dashboard" | "parser">("dashboard");
const toolPanelOpen = ref(true);
const trafficWorkspace = ref<HTMLElement | null>(null);
const toolPanelRatio = ref(loadLayoutPreferences().tool_panel_ratio);
const trafficWorkspaceStyle = computed<Record<string, string>>(() => ({
  "--tool-panel-width": `${toolPanelRatio.value * 100}%`,
}));
const detachedTools = ref<Record<WorkspaceTool, boolean>>({ presets: false, dashboard: false, parser: false });
const storedEditor = loadSendEditor(props.profileId);
const format = ref<DataFormat>(storedEditor.format);
const textEncoding = ref<TextEncoding>(storedEditor.text_encoding);
const lineEnding = ref<LineEnding>(storedEditor.line_ending);
const sendData = ref(storedEditor.data);
const frameConfig = ref<HexFrameConfig>(loadHexFrameConfig(props.profileId));
const frameBuilderOpen = ref(false);
const presetFrameBuilderOpen = ref(false);
const presetFrameTargetId = ref<string | null>(null);
const intervalMs = ref(storedEditor.interval_ms);
const sending = ref(false);
const changingPeriodic = ref(false);
const presets = ref<SendPreset[]>(loadSendPresets(props.profileId));
const presetFramePreviews = ref<Record<string, { hex: string; error: string; loading: boolean }>>({});
const sendingPresetId = ref<string | null>(null);
const sequenceRunning = ref(false);
let sequenceGeneration = 0;
let editorSaveTimer: number | undefined;
let presetSaveTimer: number | undefined;
let presetPreviewTimer: number | undefined;
let stopWorkspaceResize: (() => void) | null = null;
const detachedWindows = new Map<WorkspaceTool, Window>();
const detachedWindowTimers = new Map<WorkspaceTool, number>();
const presetPreviewSignatures = new Map<string, string>();
const presetPreviewGenerations = new Map<string, number>();
const pendingAutoSendPresetIds = new Set<string>();
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
const presetFrameTarget = computed(() => presets.value.find((preset) => preset.id === presetFrameTargetId.value) ?? null);

watch(format, (value) => {
  if (value === "hex") displayHex.value = true;
});
watch([sendData, format, textEncoding, lineEnding, intervalMs], scheduleEditorSave);
watch(() => props.periodicStatus.interval_ms, (value) => {
  if (value !== null) intervalMs.value = value;
});
watch(() => props.periodicStatus.frame_sequences, applyFrameSequences, { deep: true });
watch(
  () => presets.value.map((preset) => ({
    id: preset.id,
    data: preset.data,
    format: preset.format,
    frame_config: preset.frame_config,
  })),
  schedulePresetPreviewRefresh,
  { deep: true, immediate: true },
);
onMounted(() => {
  window.addEventListener("beforeunload", persistPendingState);
  window.addEventListener("storage", handleStorageChange);
});
onBeforeUnmount(() => {
  sequenceGeneration += 1;
  endWorkspaceResize();
  window.removeEventListener("beforeunload", persistPendingState);
  window.removeEventListener("storage", handleStorageChange);
  persistPendingState();
  if (editorSaveTimer !== undefined) window.clearTimeout(editorSaveTimer);
  if (presetSaveTimer !== undefined) window.clearTimeout(presetSaveTimer);
  if (presetPreviewTimer !== undefined) window.clearTimeout(presetPreviewTimer);
  for (const timer of detachedWindowTimers.values()) window.clearInterval(timer);
  detachedWindowTimers.clear();
});

function beginWorkspaceResize(event: PointerEvent): void {
  if (event.button !== 0 || !trafficWorkspace.value) return;
  event.preventDefault();
  endWorkspaceResize();
  document.body.classList.add("layout-resizing");
  updateToolPanelRatio(event.clientX);
  const handleMove = (moveEvent: PointerEvent): void => updateToolPanelRatio(moveEvent.clientX);
  const handleEnd = (): void => {
    persistLayoutPreferences();
    endWorkspaceResize();
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleEnd, { once: true });
  window.addEventListener("pointercancel", handleEnd, { once: true });
  stopWorkspaceResize = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleEnd);
    window.removeEventListener("pointercancel", handleEnd);
    document.body.classList.remove("layout-resizing");
  };
}

function updateToolPanelRatio(clientX: number): void {
  const bounds = trafficWorkspace.value?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0) return;
  toolPanelRatio.value = clampToolPanelRatio((bounds.right - clientX) / bounds.width, bounds.width);
}

function handleWorkspaceResizeKey(event: KeyboardEvent): void {
  if (event.key === "Home") {
    event.preventDefault();
    resetWorkspaceSize();
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const step = event.shiftKey ? 0.05 : 0.02;
  const width = trafficWorkspace.value?.clientWidth ?? 1_200;
  toolPanelRatio.value = clampToolPanelRatio(
    toolPanelRatio.value + (event.key === "ArrowLeft" ? step : -step),
    width,
  );
  persistLayoutPreferences();
}

function resetWorkspaceSize(): void {
  toolPanelRatio.value = DEFAULT_LAYOUT_PREFERENCES.tool_panel_ratio;
  persistLayoutPreferences();
}

function clampToolPanelRatio(value: number, workspaceWidth: number): number {
  const minimum = Math.max(0.2, 360 / workspaceWidth);
  const maximum = Math.min(0.8, (workspaceWidth - 287) / workspaceWidth);
  if (minimum > maximum) return Math.min(0.8, Math.max(0.2, value));
  return Math.min(maximum, Math.max(minimum, value));
}

function persistLayoutPreferences(): void {
  try {
    saveLayoutPreferences({ ...loadLayoutPreferences(), tool_panel_ratio: toolPanelRatio.value });
  } catch {
    // The current layout remains usable when local storage is unavailable.
  }
}

function endWorkspaceResize(): void {
  stopWorkspaceResize?.();
  stopWorkspaceResize = null;
}

function selectTool(tool: WorkspaceTool): void {
  if (detachedTools.value[tool]) {
    focusDetachedTool(tool);
    return;
  }
  activeTool.value = tool;
  if (tool === "dashboard" || tool === "parser") analyzerView.value = tool;
  toolPanelOpen.value = true;
}

function openDetachedTool(tool = activeTool.value): void {
  const existing = detachedWindows.get(tool);
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("tool", tool);
  url.searchParams.set("profile", props.profileId);
  const popup = window.open(
    url,
    `snd-${tool}-${props.profileId}`,
    tool === "parser" ? "popup,width=1040,height=760" : "popup,width=900,height=680",
  );
  if (!popup) {
    emit("error", "独立窗口被浏览器拦截，请允许此站点打开弹出式窗口");
    return;
  }
  detachedWindows.set(tool, popup);
  detachedTools.value = { ...detachedTools.value, [tool]: true };
  popup.focus();
  selectNextAvailableTool(tool);
  const timer = window.setInterval(() => {
    if (!popup.closed) return;
    restoreDetachedTool(tool);
  }, 300);
  detachedWindowTimers.set(tool, timer);
}

function selectNextAvailableTool(detachedTool: WorkspaceTool): void {
  if (props.toolOnly || activeTool.value !== detachedTool) return;
  const nextTool = TOOL_ORDER.find((tool) => !detachedTools.value[tool]);
  if (nextTool) selectTool(nextTool);
  else toolPanelOpen.value = false;
}

function restoreDetachedTool(tool: WorkspaceTool): void {
  const timer = detachedWindowTimers.get(tool);
  if (timer !== undefined) window.clearInterval(timer);
  detachedWindowTimers.delete(tool);
  detachedWindows.delete(tool);
  detachedTools.value = { ...detachedTools.value, [tool]: false };
  selectTool(tool);
}

function focusDetachedTool(tool: WorkspaceTool): void {
  const popup = detachedWindows.get(tool);
  if (popup && !popup.closed) popup.focus();
}

function handleStorageChange(event: StorageEvent): void {
  if (event.storageArea !== localStorage) return;
  if (event.key === LAYOUT_PREFERENCES_KEY) {
    toolPanelRatio.value = loadLayoutPreferences().tool_panel_ratio;
    return;
  }
  if (event.key === sendPresetsStorageKey(props.profileId)) {
    const storedPresets = loadSendPresets(props.profileId);
    if (JSON.stringify(storedPresets) !== JSON.stringify(presets.value)) presets.value = storedPresets;
    return;
  }
  if (event.key === sendEditorStorageKey(props.profileId)) {
    const editor = loadSendEditor(props.profileId);
    sendData.value = editor.data;
    format.value = editor.format;
    textEncoding.value = editor.text_encoding;
    lineEnding.value = editor.line_ending;
    intervalMs.value = editor.interval_ms;
    return;
  }
  if (event.key === hexFrameStorageKey(props.profileId)) {
    frameConfig.value = loadHexFrameConfig(props.profileId);
  }
}

async function sendPayload(payload: SendPayload): Promise<Record<string, string> | null> {
  const response = await apiRequest<{
    ok: boolean;
    message: string;
    frame_sequences: Record<string, string> | null;
  }>("/api/send", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.frame_sequences;
}

async function send(): Promise<void> {
  sending.value = true;
  try {
    applyFrameSequences(await sendPayload(editorPayload.value));
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
  applyFrameConfig(preset.frame_config
    ? { ...cloneFrameConfig(preset.frame_config), id: createFrameConfigId("editor") }
    : cloneFrameConfig(DEFAULT_HEX_FRAME_CONFIG));
}

function openFrameBuilder(): void {
  format.value = "hex";
  frameBuilderOpen.value = true;
}

function openPresetFrameBuilder(preset: SendPreset): void {
  if (!preset.frame_config) {
    updatePreset(preset.id, {
      format: "hex",
      frame_config: {
        version: 1,
        id: createFrameConfigId(`preset-${preset.id}`),
        enabled: false,
        fields: [],
      },
    });
  } else if (preset.format !== "hex") {
    updatePreset(preset.id, { format: "hex" });
  }
  presetFrameTargetId.value = preset.id;
  presetFrameBuilderOpen.value = true;
}

function applyPresetFrameConfig(config: HexFrameConfig): void {
  const presetId = presetFrameTargetId.value;
  if (!presetId) return;
  updatePreset(presetId, { format: "hex", frame_config: config });
}

function applyFrameConfig(config: HexFrameConfig): void {
  frameConfig.value = config;
  try {
    saveHexFrameConfig(config, props.profileId);
  } catch {
    emit("error", "HEX 帧配置保存失败，请检查浏览器本地存储空间");
  }
}

function canSendPreset(preset: SendPreset): boolean {
  return preset.data.length > 0 || (preset.format === "hex" && frameHasIndependentPayload(preset.frame_config));
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

function updateGeneratedField(fieldId: string, value: string): void {
  const fields = frameConfig.value.fields.map((field) => field.id === fieldId && field.kind === "data"
    ? { ...field, value }
    : field);
  applyFrameConfig({ ...frameConfig.value, fields });
}

function updatePresetGeneratedField(presetId: string, fieldId: string, value: string): void {
  const preset = presets.value.find((item) => item.id === presetId);
  const config = preset?.frame_config;
  if (!config) return;
  const fields = config.fields.map((field) => field.id === fieldId && field.kind === "data"
    ? { ...field, value }
    : field);
  updatePreset(presetId, { frame_config: { ...config, fields } });
}

function commitPresetGeneratedField(presetId: string): void {
  const preset = presets.value.find((item) => item.id === presetId);
  if (!preset?.auto_send_on_change || !preset.enabled || !props.connected) return;
  if (sequenceRunning.value || !canSendPreset(preset)) return;
  pendingAutoSendPresetIds.add(presetId);
  void flushPendingAutoSend();
}

async function flushPendingAutoSend(): Promise<void> {
  if (sendingPresetId.value !== null || sequenceRunning.value) return;
  const presetId = pendingAutoSendPresetIds.values().next().value as string | undefined;
  if (!presetId) return;
  pendingAutoSendPresetIds.delete(presetId);
  const preset = presets.value.find((item) => item.id === presetId);
  if (!preset?.auto_send_on_change || !preset.enabled || !props.connected || !canSendPreset(preset)) {
    void flushPendingAutoSend();
    return;
  }
  await sendPreset(preset);
}

async function sendPreset(preset: SendPreset): Promise<void> {
  sendingPresetId.value = preset.id;
  try {
    applyPresetFrameSequences(preset.id, await sendPayload(preset));
  } catch (error) {
    emitError(error, "预设发送失败");
  } finally {
    sendingPresetId.value = null;
    void flushPendingAutoSend();
  }
}

function applyPresetFrameSequences(presetId: string, sequences: Record<string, string> | null): void {
  if (!sequences) return;
  const preset = presets.value.find((item) => item.id === presetId);
  const config = preset?.frame_config;
  if (!config) return;
  let changed = false;
  const fields = config.fields.map((field) => {
    if (field.kind !== "sequence" || sequences[field.id] === undefined) return field;
    changed = true;
    return { ...field, value: sequences[field.id]! };
  });
  if (changed) updatePreset(presetId, { frame_config: { ...config, fields } });
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
    auto_send_on_change: false,
    delay_ms: 50,
    updated_at: now,
  });
  schedulePresetSave();
}

function duplicatePreset(source: SendPreset): void {
  if (presets.value.length >= MAX_SEND_PRESETS) {
    emit("error", `发送预设最多保存 ${MAX_SEND_PRESETS} 条`);
    return;
  }
  const index = presets.value.findIndex((preset) => preset.id === source.id);
  if (index < 0) return;
  const id = createPresetId();
  const duplicate: SendPreset = {
    ...cloneSendPreset(source),
    id,
    name: duplicatePresetName(source.name),
    updated_at: new Date().toISOString(),
    ...(source.frame_config
      ? { frame_config: { ...cloneFrameConfig(source.frame_config), id: createFrameConfigId(`preset-${id}`) } }
      : {}),
  };
  presets.value.splice(index + 1, 0, duplicate);
  schedulePresetSave();
}

function reorderPreset(draggedId: string, targetId: string, placement: "before" | "after"): void {
  if (draggedId === targetId) return;
  const sourceIndex = presets.value.findIndex((preset) => preset.id === draggedId);
  if (sourceIndex < 0) return;
  const [preset] = presets.value.splice(sourceIndex, 1);
  if (!preset) return;
  const targetIndex = presets.value.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) {
    presets.value.splice(sourceIndex, 0, preset);
    return;
  }
  presets.value.splice(targetIndex + (placement === "after" ? 1 : 0), 0, preset);
  schedulePresetSave();
}

function duplicatePresetName(name: string): string {
  const base = name.trim() || "未命名";
  const suffix = " 副本";
  return `${base.slice(0, 60 - suffix.length)}${suffix}`;
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
  pendingAutoSendPresetIds.delete(preset.id);
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
      applyPresetFrameSequences(preset.id, await sendPayload(preset));
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

function persistEditor(): boolean {
  try {
    saveSendEditor({
      version: 1,
      ...editorPayload.value,
      interval_ms: intervalMs.value,
    }, props.profileId);
    saveHexFrameConfig(frameConfig.value, props.profileId);
    return true;
  } catch {
    emit("error", "发送区内容保存失败，请检查浏览器本地存储空间");
    return false;
  }
}

function schedulePresetSave(): void {
  if (presetSaveTimer !== undefined) window.clearTimeout(presetSaveTimer);
  presetSaveTimer = window.setTimeout(persistPresets, 180);
}

function schedulePresetPreviewRefresh(): void {
  if (presetPreviewTimer !== undefined) window.clearTimeout(presetPreviewTimer);
  presetPreviewTimer = window.setTimeout(refreshPresetPreviews, 100);
}

function refreshPresetPreviews(): void {
  const activeIds = new Set<string>();
  for (const preset of presets.value) {
    const config = preset.frame_config;
    if (preset.format !== "hex" || !config?.enabled) continue;
    activeIds.add(preset.id);
    const signature = JSON.stringify({ data: preset.data, frame_config: config });
    if (presetPreviewSignatures.get(preset.id) === signature) continue;
    presetPreviewSignatures.set(preset.id, signature);
    const generation = (presetPreviewGenerations.get(preset.id) ?? 0) + 1;
    presetPreviewGenerations.set(preset.id, generation);
    presetFramePreviews.value = {
      ...presetFramePreviews.value,
      [preset.id]: { hex: "", error: "", loading: true },
    };
    void refreshPresetPreview(preset.id, preset.data, config, generation);
  }

  let changed = false;
  const next = { ...presetFramePreviews.value };
  for (const id of Object.keys(next)) {
    if (activeIds.has(id)) continue;
    delete next[id];
    presetPreviewSignatures.delete(id);
    presetPreviewGenerations.set(id, (presetPreviewGenerations.get(id) ?? 0) + 1);
    changed = true;
  }
  if (changed) presetFramePreviews.value = next;
}

async function refreshPresetPreview(
  presetId: string,
  data: string,
  config: HexFrameConfig,
  generation: number,
): Promise<void> {
  try {
    const result = await apiRequest<{ hex: string }>("/api/frame/preview", {
      method: "POST",
      body: JSON.stringify({ data, frame_config: config }),
    });
    if (presetPreviewGenerations.get(presetId) !== generation) return;
    presetFramePreviews.value = {
      ...presetFramePreviews.value,
      [presetId]: { hex: result.hex, error: "", loading: false },
    };
  } catch (error) {
    if (presetPreviewGenerations.get(presetId) !== generation) return;
    presetFramePreviews.value = {
      ...presetFramePreviews.value,
      [presetId]: {
        hex: "",
        error: error instanceof Error ? error.message : "帧预览生成失败",
        loading: false,
      },
    };
  }
}

function persistPresets(): boolean {
  try {
    saveSendPresets(presets.value, props.profileId);
    return true;
  } catch {
    emit("error", "发送预设保存失败，请检查浏览器本地存储空间");
    return false;
  }
}

function persistPendingState(): boolean {
  const editorSaved = persistEditor();
  const presetsSaved = persistPresets();
  const parserSaved = frameAnalyzer.value?.persistPendingState() ?? true;
  return editorSaved && presetsSaved && parserSaved;
}

defineExpose({ persistPendingState });

function createPresetId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createFrameConfigId(prefix: string): string {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`.slice(0, 80);
}

function cloneFrameConfig(config: HexFrameConfig): HexFrameConfig {
  return JSON.parse(JSON.stringify(config)) as HexFrameConfig;
}

function frameHasIndependentPayload(config: HexFrameConfig | undefined): boolean {
  return Boolean(config?.enabled && config.fields.some((field) => {
    if (field.kind === "sequence" || field.kind === "length" || field.kind === "checksum") return true;
    if (field.kind === "data" && field.source === "editor") return false;
    return field.value.trim().length > 0;
  }));
}

function emitError(error: unknown, fallback: string): void {
  emit("error", error instanceof Error ? error.message : fallback);
}
</script>

<template>
    <section class="console-area" :class="{ 'tool-only-console': toolOnly }">
      <div v-if="toolOnly === 'presets'" class="detached-tool-header">
        <div><span class="eyebrow">TOOL WINDOW</span><strong>发送预设</strong></div>
        <button class="icon-tool-button" type="button" title="关闭窗口" aria-label="关闭窗口" @click="emit('close-tool')"><X :size="16" /></button>
      </div>

      <div v-if="!toolOnly" class="console-toolbar">
        <div class="console-view-heading"><span class="eyebrow">RECEIVE</span><strong><List :size="15" />通信日志</strong></div>
        <div class="toolbar-actions">
          <label class="toggle">
            <input v-model="displayHex" type="checkbox" />
            <span>HEX 显示</span>
          </label>
          <label class="toggle">
            <input v-model="autoScroll" type="checkbox" />
            <span>自动滚动</span>
          </label>
          <label class="toggle">
            <input v-model="showTransmitLogs" type="checkbox" />
            <span>显示发送</span>
          </label>
          <button
            class="icon-tool-button"
            :class="{ active: toolPanelOpen }"
            type="button"
            :title="toolPanelOpen ? '关闭工具面板' : '打开工具面板'"
            :aria-label="toolPanelOpen ? '关闭工具面板' : '打开工具面板'"
            @click="toolPanelOpen = !toolPanelOpen"
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

    <div
      v-if="!toolOnly"
      ref="trafficWorkspace"
      class="traffic-workspace"
      :class="{ 'tool-panel-open': toolPanelOpen }"
      :style="trafficWorkspaceStyle"
    >
      <VirtualLog :logs="visibleLogs" :display-hex="displayHex" :auto-scroll="autoScroll" />
      <div
        v-show="toolPanelOpen"
        class="workspace-resize-handle"
        role="separator"
        aria-label="调整通信日志与工具面板宽度"
        aria-orientation="vertical"
        :aria-valuenow="Math.round(toolPanelRatio * 100)"
        aria-valuemin="20"
        aria-valuemax="80"
        tabindex="0"
        title="拖动调整面板宽度，双击恢复默认"
        @pointerdown="beginWorkspaceResize"
        @keydown="handleWorkspaceResizeKey"
        @dblclick="resetWorkspaceSize"
      ></div>
      <aside v-show="toolPanelOpen" class="workspace-tool-panel">
        <header class="workspace-tool-tabs">
          <div role="tablist" aria-label="工具面板">
            <button v-if="!detachedTools.presets" type="button" :class="{ active: activeTool === 'presets' }" @click="selectTool('presets')"><List :size="13" />发送预设</button>
            <button v-if="!detachedTools.dashboard" type="button" :class="{ active: activeTool === 'dashboard' }" @click="selectTool('dashboard')"><Gauge :size="13" />仪表盘</button>
            <button v-if="!detachedTools.parser" type="button" :class="{ active: activeTool === 'parser' }" @click="selectTool('parser')"><Settings :size="13" />解析配置</button>
          </div>
          <div>
            <button class="icon-tool-button" type="button" title="拆分到独立窗口" aria-label="拆分当前工具到独立窗口" @click="openDetachedTool()"><ExternalLink :size="14" /></button>
            <button class="icon-tool-button" type="button" title="关闭工具面板" aria-label="关闭工具面板" @click="toolPanelOpen = false"><X :size="14" /></button>
          </div>
        </header>
        <SendPresetPanel
          v-show="activeTool === 'presets'"
          :presets="presets"
          :preset-frame-previews="presetFramePreviews"
          :connected="connected"
          open
          :editor-locked="periodicStatus.active"
          :sending-preset-id="sendingPresetId"
          :sequence-running="sequenceRunning"
          :closable="false"
          @close="toolPanelOpen = false"
          @add="addPreset"
          @update="updatePreset"
          @duplicate="duplicatePreset"
          @reorder="reorderPreset"
          @remove="removePreset"
          @load="loadPreset"
          @send="sendPreset"
          @edit-frame="openPresetFrameBuilder"
          @update-generated="updatePresetGeneratedField"
          @commit-generated="commitPresetGeneratedField"
          @toggle-sequence="toggleSequence"
        />
        <FrameAnalyzer
          ref="frameAnalyzer"
          v-show="activeTool === 'dashboard' || activeTool === 'parser'"
          :profile-id="profileId"
          :frames="receivedFrames"
          :view="analyzerView"
          @request-view="selectTool"
          @error="emit('error', $event)"
        />
      </aside>
    </div>

    <div v-else class="detached-preset-content">
      <SendPresetPanel
        :presets="presets"
        :preset-frame-previews="presetFramePreviews"
        :connected="connected"
        open
        :editor-locked="periodicStatus.active"
        :sending-preset-id="sendingPresetId"
        :sequence-running="sequenceRunning"
        :closable="false"
        @close="emit('close-tool')"
        @add="addPreset"
        @update="updatePreset"
        @duplicate="duplicatePreset"
        @reorder="reorderPreset"
        @remove="removePreset"
        @load="loadPreset"
        @send="sendPreset"
        @edit-frame="openPresetFrameBuilder"
        @update-generated="updatePresetGeneratedField"
        @commit-generated="commitPresetGeneratedField"
        @toggle-sequence="toggleSequence"
      />
    </div>

    <form v-if="!toolOnly" class="send-panel" @submit.prevent="send">
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
      <FrameGeneratedControls
        :config="format === 'hex' ? frameConfig : undefined"
        :disabled="periodicStatus.active"
        @update="updateGeneratedField"
      />
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
    <HexFrameBuilder
      v-if="presetFrameTarget?.frame_config"
      v-model:open="presetFrameBuilderOpen"
      :config="presetFrameTarget.frame_config"
      :editor-data="presetFrameTarget.data"
      :title="`预设 HEX 帧格式 · ${presetFrameTarget.name || '未命名'}`"
      :show-examples="false"
      @apply="applyPresetFrameConfig"
      @error="emit('error', $event)"
    />
  </section>
</template>
