<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Activity, ChevronDown, ChevronUp, Copy, FileInput, Gauge, Plus, RotateCcw, Save, Settings, Trash2 } from "@lucide/vue";
import { frameParserMinimumByteLength, MAX_FRAME_PARSER_FIELDS, parseReceivedFrame, reflowFrameParserFields, validateFrameParserConfig } from "../frame-parser";
import { frameParserStorageKey, loadFrameParserConfig, saveFrameParserConfig } from "../storage";
import type {
  FrameParserConfig,
  FrameParserDataType,
  FrameParserField,
  ParsedFieldValue,
  ReceivedFrame,
} from "../types";

const props = defineProps<{
  profileId: string;
  frames: ReceivedFrame[];
  view: "dashboard" | "parser";
  standalone?: boolean;
}>();

const emit = defineEmits<{
  error: [message: string];
  "request-view": [view: "dashboard" | "parser"];
}>();

interface HistoryPoint {
  index: number;
  value: number;
}

const storedConfig = loadFrameParserConfig(props.profileId);
const config = ref<FrameParserConfig>(storedConfig);
const draft = ref<FrameParserConfig>(cloneParserConfig(storedConfig));
const selectedFieldId = ref<string | null>(draft.value.fields[0]?.id ?? null);
const latestValues = ref<Record<string, ParsedFieldValue>>({});
const histories = ref<Record<string, HistoryPoint[]>>({});
const matchedCount = ref(0);
const unmatchedCount = ref(0);
const errorCount = ref(0);
const latestTime = ref("--:--:--");
const latestPeer = ref("");
const latestFrameHex = ref("");
let lastFrameId = props.frames.at(-1)?.id ?? 0;
let pointIndex = 0;

const selectedField = computed(() => draft.value.fields.find((field) => field.id === selectedFieldId.value) ?? null);
const selectedFieldIndex = computed(() => draft.value.fields.findIndex((field) => field.id === selectedFieldId.value));
const visibleFields = computed(() => config.value.fields.filter((field) => field.kind === "value" && field.visible));
const layoutByteLength = computed(() => frameParserMinimumByteLength(draft.value.fields));
const availableLengthFields = computed(() => draft.value.fields
  .slice(0, Math.max(0, selectedFieldIndex.value))
  .filter((field) => field.kind === "value" && field.length_mode === "fixed" && field.data_type === "uint"));

watch(
  () => props.frames.at(-1)?.id,
  () => processPendingFrames(),
  { immediate: true },
);

watch(() => props.view, (view) => {
  if (view === "parser") resetDraft();
});

onMounted(() => window.addEventListener("storage", handleStorageChange));
onBeforeUnmount(() => window.removeEventListener("storage", handleStorageChange));

function processPendingFrames(): void {
  const pending = props.frames.filter((frame) => frame.id > lastFrameId);
  if (pending.length === 0) return;
  lastFrameId = pending.at(-1)!.id;
  if (!config.value.enabled) return;

  const nextValues = { ...latestValues.value };
  const nextHistories = { ...histories.value };
  const copiedHistories = new Set<string>();
  let matched = 0;
  let unmatched = 0;
  let errors = 0;
  for (const frame of pending) {
    const result = parseReceivedFrame(config.value, frame.hex);
    if (result.status === "unmatched") {
      unmatched += 1;
      continue;
    }
    if (result.status === "error") {
      errors += 1;
      continue;
    }
    matched += 1;
    pointIndex += 1;
    latestTime.value = formatTimestamp(frame.timestamp);
    latestPeer.value = frame.peer;
    latestFrameHex.value = frame.hex;
    for (const value of result.values) {
      nextValues[value.field_id] = value;
      if (value.numeric === null) continue;
      if (!copiedHistories.has(value.field_id)) {
        nextHistories[value.field_id] = [...(nextHistories[value.field_id] ?? [])];
        copiedHistories.add(value.field_id);
      }
      nextHistories[value.field_id]!.push({ index: pointIndex, value: value.numeric });
    }
  }
  for (const fieldId of copiedHistories) {
    nextHistories[fieldId] = nextHistories[fieldId]!.slice(-240);
  }
  matchedCount.value += matched;
  unmatchedCount.value += unmatched;
  errorCount.value += errors;
  if (matched > 0) {
    latestValues.value = nextValues;
    histories.value = nextHistories;
  }
}

function resetDraft(): void {
  draft.value = cloneParserConfig(config.value);
  selectedFieldId.value = draft.value.fields[0]?.id ?? null;
}

function applySettings(): boolean {
  normalizeDraftHex();
  reflowOffsets();
  draft.value.minimum_length = Math.max(draft.value.minimum_length, layoutByteLength.value);
  const error = validateFrameParserConfig(draft.value);
  if (error) {
    emit("error", error);
    return false;
  }
  try {
    const nextConfig = cloneParserConfig(draft.value);
    const changed = JSON.stringify(nextConfig) !== JSON.stringify(config.value);
    config.value = nextConfig;
    saveFrameParserConfig(config.value, props.profileId);
    if (changed) clearAnalysis();
    return true;
  } catch {
    emit("error", "解析配置保存失败，请检查浏览器本地存储空间");
    return false;
  }
}

defineExpose({ persistPendingState: applySettings });

function handleStorageChange(event: StorageEvent): void {
  if (event.storageArea !== localStorage || event.key !== frameParserStorageKey(props.profileId)) return;
  config.value = loadFrameParserConfig(props.profileId);
  if (props.view === "parser") resetDraft();
  clearAnalysis();
}

function addDataField(variable: boolean): void {
  const lengthField = [...draft.value.fields].reverse().find((field) => (
    field.kind === "value" && field.length_mode === "fixed" && field.data_type === "uint"
  ));
  appendField(baseField({
    name: variable ? "变长字符串" : "定长数据",
    data_type: variable ? "text" : "hex",
    text_encoding: "utf-8",
    length_mode: variable ? (lengthField ? "field" : "remaining") : "fixed",
    length_field_id: variable ? (lengthField?.id ?? null) : null,
  }));
}

function addLengthField(): void {
  appendField(baseField({ name: "帧长度", data_type: "uint", byte_length: 1, decimals: 0 }));
}

function addFixedField(): void {
  appendField(baseField({
    kind: "fixed",
    name: draft.value.fields.length === 0 ? "帧头" : "固定字节",
    byte_length: 2,
    match_hex: draft.value.fields.length === 0 ? "AA 55" : "00 00",
    visible: false,
  }));
}

function addSkipField(): void {
  appendField(baseField({ kind: "skip", name: "保留字节", byte_length: 1, visible: false }));
}

function appendField(field: FrameParserField): void {
  if (draft.value.fields.length >= MAX_FRAME_PARSER_FIELDS) {
    emit("error", `解析字段最多 ${MAX_FRAME_PARSER_FIELDS} 个`);
    return;
  }
  draft.value.fields.push(field);
  reflowOffsets();
  selectedFieldId.value = field.id;
}

function baseField(changes: Partial<FrameParserField>): FrameParserField {
  return {
    id: createId("field"),
    name: "数据字段",
    kind: "value",
    offset: nextOffset(),
    byte_length: 1,
    length_mode: "fixed",
    length_field_id: null,
    match_hex: "",
    data_type: "hex",
    text_encoding: "utf-8",
    byte_order: "big",
    bit_index: 0,
    scale: 1,
    value_offset: 0,
    decimals: 0,
    unit: "",
    visible: true,
    display: "number",
    minimum: 0,
    maximum: 100,
    color: fieldColor(draft.value.fields.length),
    ...changes,
  };
}

function removeSelected(): void {
  const index = selectedFieldIndex.value;
  if (index < 0) return;
  const [removed] = draft.value.fields.splice(index, 1);
  if (removed) {
    for (const field of draft.value.fields) {
      if (field.length_field_id !== removed.id) continue;
      field.length_mode = "remaining";
      field.length_field_id = null;
    }
  }
  reflowOffsets();
  selectedFieldId.value = draft.value.fields[Math.min(index, draft.value.fields.length - 1)]?.id ?? null;
}

function moveSelected(direction: -1 | 1): void {
  const index = selectedFieldIndex.value;
  const target = index + direction;
  if (index < 0 || target < 0 || target >= draft.value.fields.length) return;
  const [field] = draft.value.fields.splice(index, 1);
  if (field) draft.value.fields.splice(target, 0, field);
  reflowOffsets();
}

function duplicateSelected(): void {
  const index = selectedFieldIndex.value;
  const field = selectedField.value;
  if (index < 0 || !field || draft.value.fields.length >= MAX_FRAME_PARSER_FIELDS) return;
  const copy = structuredClone(field);
  copy.id = createId("field");
  copy.name = `${copy.name} 副本`;
  draft.value.fields.splice(index + 1, 0, copy);
  reflowOffsets();
  selectedFieldId.value = copy.id;
}

function loadParserExample(): void {
  draft.value.match_offset = 0;
  draft.value.match_hex = "";
  const length = baseField({ kind: "value", name: "字符串长度", byte_length: 1, data_type: "uint" });
  draft.value.fields = [
    baseField({ kind: "fixed", name: "帧头", byte_length: 2, match_hex: "AA 55", visible: false }),
    baseField({ kind: "value", name: "功能码", byte_length: 1, data_type: "uint" }),
    length,
    baseField({ kind: "value", name: "字符串载荷", data_type: "text", text_encoding: "utf-8", length_mode: "field", length_field_id: length.id }),
    baseField({ kind: "fixed", name: "帧尾", byte_length: 2, match_hex: "0D 0A", visible: false }),
  ];
  reflowOffsets();
  draft.value.minimum_length = layoutByteLength.value;
  selectedFieldId.value = draft.value.fields[0]?.id ?? null;
}

function normalizeDraftHex(): void {
  draft.value.match_hex = formatHex(draft.value.match_hex);
  for (const field of draft.value.fields) {
    if (field.kind !== "fixed") continue;
    field.match_hex = formatHex(field.match_hex);
    field.byte_length = Math.max(1, Math.ceil(field.match_hex.replaceAll(/\s/g, "").length / 2));
  }
}

function updateMatchHex(event: Event): void {
  const input = event.target as HTMLInputElement;
  draft.value.match_hex = formatHex(input.value);
  input.value = draft.value.match_hex;
}

function updateFieldType(field: FrameParserField, event: Event): void {
  const type = (event.target as HTMLSelectElement).value as FrameParserDataType;
  field.data_type = type;
  if (type === "float32") field.byte_length = 4;
  if (type === "float64") field.byte_length = 8;
  if (type === "hex" || type === "text" || type === "ascii") field.display = "number";
  if (field.length_mode !== "fixed" && type !== "hex" && type !== "text" && type !== "ascii") {
    field.length_mode = "fixed";
    field.length_field_id = null;
  }
  if (type === "boolean" && field.display === "number") field.display = "status";
  field.bit_index = Math.min(field.bit_index, field.byte_length * 8 - 1);
  reflowOffsets();
}

function updateLengthMode(field: FrameParserField): void {
  if (field.length_mode === "fixed") {
    field.length_field_id = null;
  } else {
    if (field.data_type !== "hex" && field.data_type !== "text" && field.data_type !== "ascii") field.data_type = "text";
    field.display = "number";
    field.length_field_id = field.length_mode === "field" ? (availableLengthFields.value.at(-1)?.id ?? null) : null;
  }
  reflowOffsets();
}

function updateFieldLength(field: FrameParserField): void {
  field.bit_index = Math.min(field.bit_index, Math.max(0, field.byte_length * 8 - 1));
  reflowOffsets();
}

function updateFixedHex(field: FrameParserField, event: Event): void {
  const input = event.target as HTMLInputElement;
  field.match_hex = formatHex(input.value).slice(0, 191);
  input.value = field.match_hex;
  field.byte_length = Math.max(1, Math.ceil(field.match_hex.replaceAll(/\s/g, "").length / 2));
  reflowOffsets();
}

function reflowOffsets(): void {
  reflowFrameParserFields(draft.value.fields);
}

function formattedValue(field: FrameParserField): string {
  return latestValues.value[field.id]?.formatted ?? "--";
}

function rawValue(field: FrameParserField): string {
  return latestValues.value[field.id]?.raw ?? "--";
}

function numericValue(field: FrameParserField): number | null {
  return latestValues.value[field.id]?.numeric ?? null;
}

function rangeProgress(field: FrameParserField): number {
  const value = numericValue(field);
  if (value === null) return 0;
  return Math.max(0, Math.min(100, ((value - field.minimum) / (field.maximum - field.minimum)) * 100));
}

function gaugeStyle(field: FrameParserField): Record<string, string> {
  const progress = rangeProgress(field);
  return { background: `conic-gradient(${field.color} 0 ${progress * 1.8}deg, var(--line) ${progress * 1.8}deg 180deg, transparent 180deg)` };
}

function trendPath(field: FrameParserField): string {
  const points = histories.value[field.id] ?? [];
  if (points.length === 0) return "";
  const values = points.map((point) => point.value);
  let minimum = Math.min(field.minimum, ...values);
  let maximum = Math.max(field.maximum, ...values);
  if (minimum === maximum) maximum = minimum + 1;
  return points.map((point, index) => {
    const x = points.length === 1 ? 100 : (index / (points.length - 1)) * 100;
    const y = 36 - ((point.value - minimum) / (maximum - minimum)) * 34;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function clearAnalysis(): void {
  latestValues.value = {};
  histories.value = {};
  matchedCount.value = 0;
  unmatchedCount.value = 0;
  errorCount.value = 0;
  latestTime.value = "--:--:--";
  latestPeer.value = "";
  latestFrameHex.value = "";
}

function fieldSupportsNumericDisplay(field: FrameParserField): boolean {
  return field.data_type !== "hex" && field.data_type !== "text" && field.data_type !== "ascii";
}

function defaultFieldName(type: FrameParserDataType, index: number): string {
  const names: Record<FrameParserDataType, string> = {
    uint: "无符号整数",
    int: "有符号整数",
    float32: "Float32",
    float64: "Float64",
    bcd: "BCD 数值",
    boolean: "状态位",
    hex: "HEX 数据",
    text: "字符串",
    ascii: "ASCII 文本",
  };
  return `${names[type]} ${index}`;
}

function nextOffset(): number {
  return frameParserMinimumByteLength(draft.value.fields);
}

function parserFieldKindLabel(field: FrameParserField): string {
  if (field.kind === "fixed") return "固定字节";
  if (field.kind === "skip") return "跳过";
  if (field.data_type === "uint" && draft.value.fields.some((candidate) => candidate.length_field_id === field.id)) return "帧长度";
  return field.length_mode === "fixed" ? "定长数据" : "变长数据";
}

function parserFieldSummary(field: FrameParserField): string {
  if (field.kind === "fixed") return field.match_hex;
  if (field.kind === "skip") return `${field.byte_length} Byte`;
  if (field.length_mode === "remaining") return `${dataTypeLabel(field)} · 剩余字节`;
  if (field.length_mode === "field") {
    const source = draft.value.fields.find((candidate) => candidate.id === field.length_field_id);
    return `${dataTypeLabel(field)} · ${source?.name || "未选择长度"}`;
  }
  return `${dataTypeLabel(field)} · ${field.byte_length} Byte`;
}

function dataTypeLabel(field: FrameParserField): string {
  if (field.data_type === "text" || field.data_type === "ascii") return field.text_encoding.toUpperCase();
  return defaultFieldName(field.data_type, 0).replace(/ 0$/, "");
}

function parserFieldPosition(field: FrameParserField, index: number): string {
  const hasDynamicBefore = draft.value.fields.slice(0, index).some((candidate) => candidate.length_mode !== "fixed");
  if (hasDynamicBefore) return "动态位置";
  if (field.length_mode !== "fixed") return `Byte ${field.offset} 起`;
  return `Byte ${field.offset}–${field.offset + field.byte_length - 1}`;
}

function dashboardFieldPosition(field: FrameParserField): string {
  const value = latestValues.value[field.id];
  const offset = value?.offset ?? field.offset;
  const byteLength = value?.byte_length ?? field.byte_length;
  if (byteLength === 0) return `Byte ${offset} · 0 Byte`;
  return `Byte ${offset}–${offset + Math.max(0, byteLength - 1)}`;
}

function fieldColor(index: number): string {
  return ["#13A88E", "#2F7FD3", "#D68A19", "#C54D69", "#7957C8", "#4D8F3A"][index % 6]!;
}

function createId(prefix: string): string {
  const suffix = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`.slice(0, 80);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value.slice(11, 23) : date.toLocaleTimeString("zh-CN", { hour12: false, fractionalSecondDigits: 3 });
}

function formatHex(value: string): string {
  return value.replaceAll(/[^0-9A-F]/gi, "").slice(0, 131_070).replaceAll(/(..)(?=.)/g, "$1 ").toUpperCase();
}

function cloneParserConfig(value: FrameParserConfig): FrameParserConfig {
  return JSON.parse(JSON.stringify(value)) as FrameParserConfig;
}

</script>

<template>
  <section v-if="view === 'dashboard'" class="analyzer-workspace">
    <header class="analyzer-header">
      <div class="analyzer-title">
        <span class="analyzer-state" :class="{ active: config.enabled }"><Activity :size="14" /></span>
        <div>
          <strong>{{ config.name }}</strong>
          <span>{{ config.enabled ? `已匹配 ${matchedCount} 帧` : "解析未启用" }}</span>
        </div>
      </div>
      <div class="analyzer-summary">
        <span><small>最近更新</small>{{ latestTime }}</span>
        <span><small>未匹配</small>{{ unmatchedCount }}</span>
        <span :class="{ error: errorCount > 0 }"><small>错误</small>{{ errorCount }}</span>
        <button class="analyzer-clear-button" type="button" @click="clearAnalysis">清空数据</button>
        <button v-if="!standalone" class="frame-config-button" type="button" @click="emit('request-view', 'parser')"><Settings :size="14" />解析配置</button>
      </div>
    </header>

    <div v-if="!config.enabled || config.fields.length === 0" class="analyzer-empty">
      <Activity :size="34" />
      <strong>{{ config.fields.length === 0 ? "尚未配置接收字段" : "接收帧解析已停用" }}</strong>
      <button v-if="!standalone" type="button" @click="emit('request-view', 'parser')"><Settings :size="15" />配置解析格式</button>
    </div>

    <div v-else class="analyzer-scroll">
      <div class="analyzer-frame-strip">
        <span>{{ latestPeer || "本地通道" }}</span>
        <code :title="latestFrameHex">{{ latestFrameHex || "等待匹配的 RX 帧" }}</code>
      </div>
      <div class="dashboard-grid">
        <article v-for="field in visibleFields" :key="field.id" class="dashboard-widget" :class="`display-${field.display}`">
          <header>
            <span class="widget-color" :style="{ background: field.color }"></span>
            <strong>{{ field.name }}</strong>
            <small>{{ dashboardFieldPosition(field) }}</small>
          </header>

          <div v-if="field.display === 'gauge'" class="widget-gauge">
            <div class="gauge-arc" :style="gaugeStyle(field)"><span></span></div>
            <div class="gauge-value"><strong>{{ formattedValue(field) }}</strong><span>{{ field.unit }}</span></div>
            <footer><span>{{ field.minimum }}</span><span>{{ field.maximum }}</span></footer>
          </div>

          <div v-else-if="field.display === 'trend'" class="widget-trend">
            <div class="trend-current"><strong>{{ formattedValue(field) }}</strong><span>{{ field.unit }}</span></div>
            <svg viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true">
              <path class="trend-grid" d="M0 9.5H100 M0 19H100 M0 28.5H100" />
              <path class="trend-line" :d="trendPath(field)" :style="{ stroke: field.color }" />
            </svg>
          </div>

          <div v-else-if="field.display === 'bar'" class="widget-bar">
            <div><strong>{{ formattedValue(field) }}</strong><span>{{ field.unit }}</span></div>
            <div class="bar-track"><span :style="{ width: `${rangeProgress(field)}%`, background: field.color }"></span></div>
            <footer><span>{{ field.minimum }}</span><span>{{ field.maximum }}</span></footer>
          </div>

          <div v-else-if="field.display === 'status'" class="widget-status" :class="{ on: Boolean(latestValues[field.id]?.value) }">
            <span :style="{ background: latestValues[field.id]?.value ? field.color : 'var(--line-strong)' }"></span>
            <strong>{{ formattedValue(field) }}</strong>
          </div>

          <div v-else class="widget-number">
            <strong>{{ formattedValue(field) }}</strong><span>{{ field.unit }}</span>
          </div>
          <footer class="widget-raw">RAW {{ rawValue(field) }}</footer>
        </article>
      </div>
      <p v-if="visibleFields.length === 0" class="analyzer-no-visible">所有解析字段都已隐藏，请在解析配置中选择要显示的字段。</p>
    </div>
  </section>

  <section v-else class="parser-workspace">
    <header class="parser-workspace-header">
      <div><span class="eyebrow">RX FRAME PARSER</span><strong>接收帧解析格式</strong></div>
      <div>
        <span>{{ draft.fields.length }} 字段 · 至少 {{ layoutByteLength }} Byte</span>
        <button class="frame-config-button" type="button" @click="resetDraft"><RotateCcw :size="14" />撤销修改</button>
        <button class="dialog-button primary" type="button" @click="applySettings"><Save :size="14" />应用配置</button>
      </div>
    </header>

    <div class="parser-content">
          <div class="parser-general">
            <label class="settings-toggle"><input v-model="draft.enabled" type="checkbox" /><span>启用接收帧解析</span></label>
            <label class="field"><span>方案名称</span><input v-model="draft.name" maxlength="60" /></label>
            <details class="parser-advanced-filter">
              <summary>高级筛选</summary>
              <div>
                <label class="field"><span>最小帧长 (Byte)</span><input v-model.number="draft.minimum_length" type="number" min="0" max="65535" /></label>
                <label class="field"><span>固定筛选偏移 (Byte)</span><input v-model.number="draft.match_offset" type="number" min="0" max="65535" /></label>
                <label class="field parser-match-field"><span>固定筛选 HEX</span><input :value="draft.match_hex" placeholder="可留空" @input="updateMatchHex" /></label>
              </div>
            </details>
          </div>

          <div class="parser-palette">
            <strong>添加字段</strong>
            <button type="button" @click="addFixedField"><Plus :size="13" />固定字节</button>
            <button type="button" @click="addSkipField"><Plus :size="13" />跳过字节</button>
            <button type="button" @click="addLengthField"><Plus :size="13" />帧长度</button>
            <button type="button" @click="addDataField(false)"><Plus :size="13" />定长数据</button>
            <button type="button" @click="addDataField(true)"><Plus :size="13" />变长数据</button>
            <button class="parser-example-button" type="button" title="载入有序接收帧样例" @click="loadParserExample"><FileInput :size="13" />载入样例</button>
          </div>

          <div class="parser-editor">
            <div class="parser-field-list">
              <div class="parser-list-toolbar">
                <span>{{ draft.fields.length }} / {{ MAX_FRAME_PARSER_FIELDS }}</span>
                <div>
                  <button type="button" title="上移" aria-label="上移字段" :disabled="selectedFieldIndex <= 0" @click="moveSelected(-1)"><ChevronUp :size="15" /></button>
                  <button type="button" title="下移" aria-label="下移字段" :disabled="selectedFieldIndex < 0 || selectedFieldIndex >= draft.fields.length - 1" @click="moveSelected(1)"><ChevronDown :size="15" /></button>
                  <button type="button" title="复制" aria-label="复制字段" :disabled="!selectedField" @click="duplicateSelected"><Copy :size="14" /></button>
                  <button type="button" title="删除" aria-label="删除字段" :disabled="!selectedField" @click="removeSelected"><Trash2 :size="14" /></button>
                </div>
              </div>
              <button
                v-for="(field, index) in draft.fields"
                :key="field.id"
                type="button"
                :class="{ active: field.id === selectedFieldId }"
                @click="selectedFieldId = field.id"
              >
                <span>{{ index + 1 }}</span>
                <strong>{{ field.name }}</strong>
                <small>{{ parserFieldKindLabel(field) }} · {{ parserFieldPosition(field, index) }} · {{ parserFieldSummary(field) }}</small>
              </button>
              <div v-if="draft.fields.length === 0" class="parser-field-empty">从上方按帧结构依次添加字段</div>
            </div>

            <div v-if="selectedField" class="parser-properties">
              <div class="parser-property-heading">
                <div><span class="eyebrow">FIELD {{ selectedFieldIndex + 1 }}</span><strong>{{ selectedField.name }}</strong></div>
                <span>{{ parserFieldPosition(selectedField, selectedFieldIndex) }}</span>
              </div>
              <div class="parser-property-grid">
                <label class="field span-2"><span>字段名称</span><input v-model="selectedField.name" maxlength="60" /></label>

                <template v-if="selectedField.kind === 'fixed'">
                  <label class="field span-2"><span>固定匹配 HEX</span><input :value="selectedField.match_hex" placeholder="AA 55" @input="updateFixedHex(selectedField, $event)" /></label>
                </template>

                <template v-else-if="selectedField.kind === 'skip'">
                  <label class="field"><span>跳过长度 (Byte)</span><input v-model.number="selectedField.byte_length" type="number" min="1" max="65535" @change="updateFieldLength(selectedField)" /></label>
                </template>

                <template v-else>
                  <label class="field"><span>数据形式</span><select v-model="selectedField.length_mode" @change="updateLengthMode(selectedField)"><option value="fixed">定长数据</option><option value="remaining">变长：剩余字节</option><option value="field">变长：长度字段</option></select></label>
                  <label v-if="selectedField.length_mode === 'fixed'" class="field"><span>字节长度</span><input v-model.number="selectedField.byte_length" type="number" min="1" max="65535" :disabled="selectedField.data_type === 'float32' || selectedField.data_type === 'float64'" @change="updateFieldLength(selectedField)" /></label>
                  <label v-else-if="selectedField.length_mode === 'field'" class="field"><span>长度来源</span><select v-model="selectedField.length_field_id"><option :value="null">请选择</option><option v-for="field in availableLengthFields" :key="field.id" :value="field.id">{{ field.name }}</option></select></label>
                  <label class="field"><span>数据类型</span><select :value="selectedField.data_type" @change="updateFieldType(selectedField, $event)"><option value="hex">HEX 字节</option><option value="text">字符串</option><option v-if="selectedField.data_type === 'ascii'" value="ascii">ASCII（旧配置）</option><option v-if="selectedField.length_mode === 'fixed'" value="uint">UInt</option><option v-if="selectedField.length_mode === 'fixed'" value="int">Int</option><option v-if="selectedField.length_mode === 'fixed'" value="float32">Float32</option><option v-if="selectedField.length_mode === 'fixed'" value="float64">Float64</option><option v-if="selectedField.length_mode === 'fixed'" value="bcd">BCD</option><option v-if="selectedField.length_mode === 'fixed'" value="boolean">状态位</option></select></label>
                  <label v-if="selectedField.data_type === 'text' || selectedField.data_type === 'ascii'" class="field"><span>字符串编码</span><select v-model="selectedField.text_encoding"><option value="utf-8">UTF-8</option><option value="ascii">ASCII</option><option value="gbk">GBK</option></select></label>
                  <label v-else class="field"><span>字节序</span><select v-model="selectedField.byte_order" :disabled="selectedField.data_type === 'hex'"><option value="big">大端</option><option value="little">小端</option></select></label>
                  <label v-if="selectedField.data_type === 'boolean'" class="field"><span>位序号</span><input v-model.number="selectedField.bit_index" type="number" min="0" :max="selectedField.byte_length * 8 - 1" /></label>
                  <template v-if="fieldSupportsNumericDisplay(selectedField)">
                    <label class="field"><span>倍率</span><input v-model.number="selectedField.scale" type="number" step="any" /></label>
                    <label class="field"><span>数值偏移</span><input v-model.number="selectedField.value_offset" type="number" step="any" /></label>
                    <label class="field"><span>小数位</span><input v-model.number="selectedField.decimals" type="number" min="0" max="8" /></label>
                    <label class="field"><span>单位</span><input v-model="selectedField.unit" maxlength="20" placeholder="°C / V / rpm" /></label>
                  </template>
                  <label class="field"><span>仪表样式</span><select v-model="selectedField.display"><option value="number">数值卡片</option><option v-if="fieldSupportsNumericDisplay(selectedField)" value="gauge">指针仪表</option><option v-if="fieldSupportsNumericDisplay(selectedField)" value="trend">趋势曲线</option><option v-if="fieldSupportsNumericDisplay(selectedField)" value="bar">进度条</option><option v-if="fieldSupportsNumericDisplay(selectedField)" value="status">状态指示</option></select></label>
                  <label class="field"><span>显示颜色</span><span class="parser-color-input"><input v-model="selectedField.color" type="color" /><code>{{ selectedField.color }}</code></span></label>
                  <template v-if="selectedField.display === 'gauge' || selectedField.display === 'trend' || selectedField.display === 'bar'">
                    <label class="field"><span>显示最小值</span><input v-model.number="selectedField.minimum" type="number" step="any" /></label>
                    <label class="field"><span>显示最大值</span><input v-model.number="selectedField.maximum" type="number" step="any" /></label>
                  </template>
                  <label class="settings-toggle span-2"><input v-model="selectedField.visible" type="checkbox" /><span>在数据分析面板显示</span></label>
                </template>
              </div>
            </div>
            <div v-else class="parser-properties-empty"><Gauge :size="32" /><span>选择字段后配置提取规则和仪表样式</span></div>
          </div>
    </div>
  </section>
</template>
