<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronDown, ChevronUp, Copy, FileInput, Trash2, X } from "@lucide/vue";
import { apiRequest } from "../api";
import type {
  ByteOrder,
  Crc16Parameters,
  HexFrameConfig,
  HexFrameDataField,
  HexFrameField,
  FrameByteLength,
} from "../types";

const props = defineProps<{
  open: boolean;
  config: HexFrameConfig;
  editorData: string;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  apply: [config: HexFrameConfig];
  error: [message: string];
}>();

const draft = ref<HexFrameConfig>(cloneFrameConfig(props.config));
const selectedId = ref<string | null>(null);
const previewHex = ref("");
const previewSize = ref(0);
const previewError = ref("");
const selectedExample = ref("variable-modbus");
let previewGeneration = 0;
let previewTimer: number | undefined;

const selectedIndex = computed(() => draft.value.fields.findIndex((field) => field.id === selectedId.value));
const selectedField = computed(() => draft.value.fields[selectedIndex.value] ?? null);
const fieldOptions = computed(() => draft.value.fields.map((field, index) => ({
  id: field.id,
  label: `${index + 1}. ${field.name || fieldLabel(field)}`,
})));

const addOptions: Array<{ label: string; create: () => HexFrameField }> = [
  { label: "帧头", create: () => staticField("header", "帧头", "7E") },
  { label: "帧序号", create: () => ({ id: fieldId(), kind: "sequence", name: "帧序号", byte_length: 1, value: "00", step: 1, byte_order: "big" }) },
  { label: "帧 ID", create: () => staticField("frame_id", "帧 ID", "00") },
  { label: "帧长度", create: () => ({ id: fieldId(), kind: "length", name: "帧长度", byte_length: 2, byte_order: "big", range_start_id: null, range_end_id: null }) },
  ...([1, 2, 3, 4, 8] as const).map((length) => ({
    label: `${length} Byte`,
    create: (): HexFrameDataField => ({ id: fieldId(), kind: "data", name: `${length} Byte`, byte_length: length, source: "fixed", data_type: "hex", value: "00".repeat(length), byte_order: "big" }),
  })),
  { label: "任意字节", create: () => ({ id: fieldId(), kind: "data", name: "任意字节", byte_length: null, source: "editor", data_type: "hex", value: "", byte_order: "big" }) },
  { label: "CRC16", create: () => ({ id: fieldId(), kind: "checksum", name: "CRC16-MODBUS", parameters: crcPreset("modbus"), byte_order: "little", range_start_id: null, range_end_id: null }) },
  { label: "帧尾", create: () => staticField("tail", "帧尾", "0D 0A") },
];

const crcPresets: Array<{ value: Crc16Parameters["preset"]; label: string }> = [
  { value: "modbus", label: "CRC16-MODBUS" },
  { value: "arc", label: "CRC16-ARC" },
  { value: "ccitt_false", label: "CRC16-CCITT-FALSE" },
  { value: "xmodem", label: "CRC16-XMODEM" },
  { value: "x25", label: "CRC16-X25" },
  { value: "kermit", label: "CRC16-KERMIT" },
  { value: "custom", label: "自定义" },
];

const frameExamples = [
  { value: "variable-modbus", label: "通用变长帧", create: createVariableModbusExample },
  { value: "fixed-command", label: "固定命令帧", create: createFixedCommandExample },
] as const;

watch(() => props.open, (open) => {
  if (!open) return;
  draft.value = cloneFrameConfig(props.config);
  selectedId.value = draft.value.fields[0]?.id ?? null;
  schedulePreview();
});
watch([draft, () => props.editorData], schedulePreview, { deep: true });

function addField(create: () => HexFrameField): void {
  if (draft.value.fields.length >= 64) {
    emit("error", "每个帧配置最多包含 64 个字段");
    return;
  }
  const field = create();
  draft.value.fields.push(field);
  selectedId.value = field.id;
}

function moveSelected(offset: number): void {
  const from = selectedIndex.value;
  const to = from + offset;
  if (from < 0 || to < 0 || to >= draft.value.fields.length) return;
  const [field] = draft.value.fields.splice(from, 1);
  draft.value.fields.splice(to, 0, field!);
}

function duplicateSelected(): void {
  const index = selectedIndex.value;
  const field = selectedField.value;
  if (index < 0 || !field || draft.value.fields.length >= 64) return;
  const copy = cloneFrameField(field);
  copy.id = fieldId();
  copy.name = `${copy.name} 副本`;
  draft.value.fields.splice(index + 1, 0, copy);
  selectedId.value = copy.id;
}

function removeSelected(): void {
  const index = selectedIndex.value;
  if (index < 0) return;
  const [removed] = draft.value.fields.splice(index, 1);
  if (removed) clearRangeReferences(removed.id);
  selectedId.value = draft.value.fields[Math.min(index, draft.value.fields.length - 1)]?.id ?? null;
}

function apply(): void {
  if (draft.value.enabled && draft.value.fields.length === 0) {
    emit("error", "启用 HEX 帧前请至少添加一个字段");
    return;
  }
  if (previewError.value) {
    emit("error", previewError.value);
    return;
  }
  emit("apply", { ...cloneFrameConfig(draft.value), id: configId() });
  emit("update:open", false);
}

function loadExample(): void {
  const example = frameExamples.find((item) => item.value === selectedExample.value);
  if (!example) return;
  draft.value = {
    version: 1,
    id: draft.value.id,
    enabled: true,
    fields: example.create(),
  };
  selectedId.value = draft.value.fields[0]?.id ?? null;
}

function close(): void {
  emit("update:open", false);
}

function schedulePreview(): void {
  if (!props.open) return;
  if (previewTimer !== undefined) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void refreshPreview(), 120);
}

async function refreshPreview(): Promise<void> {
  const generation = ++previewGeneration;
  if (!draft.value.enabled || draft.value.fields.length === 0) {
    previewHex.value = "";
    previewSize.value = 0;
    previewError.value = "";
    return;
  }
  try {
    const result = await apiRequest<{ hex: string; size: number }>("/api/frame/preview", {
      method: "POST",
      body: JSON.stringify({ data: props.editorData, frame_config: draft.value }),
    });
    if (generation !== previewGeneration) return;
    previewHex.value = result.hex;
    previewSize.value = result.size;
    previewError.value = "";
  } catch (error) {
    if (generation !== previewGeneration) return;
    previewHex.value = "";
    previewSize.value = 0;
    previewError.value = error instanceof Error ? error.message : "帧预览生成失败";
  }
}

function applyCrcPreset(field: Extract<HexFrameField, { kind: "checksum" }>): void {
  const preset = field.parameters.preset;
  if (preset !== "custom") field.parameters = crcPreset(preset);
}

function crcPreset(preset: Exclude<Crc16Parameters["preset"], "custom">): Crc16Parameters {
  const values = {
    modbus: ["8005", "FFFF", "0000", true, true],
    arc: ["8005", "0000", "0000", true, true],
    ccitt_false: ["1021", "FFFF", "0000", false, false],
    xmodem: ["1021", "0000", "0000", false, false],
    x25: ["1021", "FFFF", "FFFF", true, true],
    kermit: ["1021", "0000", "0000", true, true],
  }[preset] as [string, string, string, boolean, boolean];
  return { preset, polynomial: values[0], initial: values[1], xor_out: values[2], reflect_input: values[3], reflect_output: values[4] };
}

function updateDataType(field: HexFrameDataField): void {
  if (field.data_type === "float32") field.byte_length = 4;
  if (field.data_type === "float64") field.byte_length = 8;
  if (field.data_type !== "hex" && field.source === "editor") field.source = "fixed";
}

function staticField(kind: "header" | "frame_id" | "tail", name: string, value: string): HexFrameField {
  return { id: fieldId(), kind, name, value };
}

function fieldId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function configId(): string {
  return `frame-${fieldId()}`.slice(0, 80);
}

function cloneFrameConfig(config: HexFrameConfig): HexFrameConfig {
  return JSON.parse(JSON.stringify(config)) as HexFrameConfig;
}

function cloneFrameField(field: HexFrameField): HexFrameField {
  return JSON.parse(JSON.stringify(field)) as HexFrameField;
}

function createVariableModbusExample(): HexFrameField[] {
  const header = staticField("header", "帧头", "55 AA");
  const sequence: HexFrameField = { id: fieldId(), kind: "sequence", name: "帧序号", byte_length: 1, value: "00", step: 1, byte_order: "big" };
  const frameId = staticField("frame_id", "功能码", "01");
  const data: HexFrameField = { id: fieldId(), kind: "data", name: "发送框数据", byte_length: null, source: "editor", data_type: "hex", value: "", byte_order: "big" };
  const length: HexFrameField = { id: fieldId(), kind: "length", name: "数据长度", byte_length: 2, byte_order: "big", range_start_id: data.id, range_end_id: data.id };
  const checksum: HexFrameField = {
    id: fieldId(),
    kind: "checksum",
    name: "CRC16-MODBUS",
    parameters: crcPreset("modbus"),
    byte_order: "little",
    range_start_id: header.id,
    range_end_id: data.id,
  };
  const tail = staticField("tail", "帧尾", "0D 0A");
  return [header, sequence, frameId, length, data, checksum, tail];
}

function createFixedCommandExample(): HexFrameField[] {
  const header = staticField("header", "帧头", "AA 55");
  const frameId = staticField("frame_id", "功能码", "10");
  const argument: HexFrameField = { id: fieldId(), kind: "data", name: "命令参数", byte_length: 2, source: "fixed", data_type: "hex", value: "00 01", byte_order: "big" };
  const checksum: HexFrameField = {
    id: fieldId(),
    kind: "checksum",
    name: "CRC16-MODBUS",
    parameters: crcPreset("modbus"),
    byte_order: "little",
    range_start_id: header.id,
    range_end_id: argument.id,
  };
  return [header, frameId, argument, checksum];
}

function fieldLabel(field: HexFrameField): string {
  const labels: Record<HexFrameField["kind"], string> = {
    header: "帧头", sequence: "帧序号", frame_id: "帧 ID", length: "帧长度",
    data: field.kind === "data" && field.byte_length ? `${field.byte_length} Byte` : "任意字节",
    checksum: "CRC16", tail: "帧尾",
  };
  return labels[field.kind];
}

function fieldSummary(field: HexFrameField): string {
  if (field.kind === "header" || field.kind === "frame_id" || field.kind === "tail") return field.value || "空";
  if (field.kind === "sequence") return `${field.value} / +${field.step}`;
  if (field.kind === "length") return `${field.byte_length} Byte ${orderLabel(field.byte_order)}`;
  if (field.kind === "checksum") return `${field.parameters.preset.toUpperCase()} ${orderLabel(field.byte_order)}`;
  if (field.kind === "data") return field.source === "editor" ? "发送框数据" : field.value || "空";
  return "";
}

function orderLabel(order: ByteOrder): string {
  return order === "big" ? "高字节在前" : "低字节在前";
}

function clearRangeReferences(id: string): void {
  for (const field of draft.value.fields) {
    if (field.kind !== "length" && field.kind !== "checksum") continue;
    if (field.range_start_id === id) field.range_start_id = null;
    if (field.range_end_id === id) field.range_end_id = null;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop frame-builder-backdrop" @mousedown.self="close">
      <section class="frame-builder-dialog" role="dialog" aria-modal="true" aria-labelledby="frame-builder-title">
        <header class="dialog-header">
          <div>
            <span class="eyebrow">HEX FRAME</span>
            <h2 id="frame-builder-title">HEX 帧格式编辑</h2>
          </div>
          <button class="bar-icon-button" type="button" title="关闭" aria-label="关闭帧配置" @click="close"><X :size="18" /></button>
        </header>

        <div class="frame-builder-content">
          <section class="frame-field-palette" aria-label="添加字段">
            <div class="frame-palette-heading">
              <strong>添加字段</strong>
              <div class="frame-palette-actions">
                <label class="frame-example-select">
                  <span>样例</span>
                  <select v-model="selectedExample">
                    <option v-for="example in frameExamples" :key="example.value" :value="example.value">{{ example.label }}</option>
                  </select>
                </label>
                <button class="frame-example-button" type="button" title="用样例替换当前草稿" @click="loadExample"><FileInput :size="14" /><span>载入样例</span></button>
                <label class="settings-toggle frame-enable-toggle"><input v-model="draft.enabled" type="checkbox" /><span>启用组帧</span></label>
              </div>
            </div>
            <div class="frame-add-buttons">
              <button v-for="option in addOptions" :key="option.label" type="button" @click="addField(option.create)">{{ option.label }}</button>
            </div>
          </section>

          <div class="frame-builder-workspace">
            <section class="frame-field-list" aria-label="帧字段列表">
              <div class="frame-list-toolbar">
                <span>{{ draft.fields.length }} 个字段</span>
                <div>
                  <button type="button" title="上移" aria-label="上移字段" :disabled="selectedIndex <= 0" @click="moveSelected(-1)"><ChevronUp :size="16" /></button>
                  <button type="button" title="下移" aria-label="下移字段" :disabled="selectedIndex < 0 || selectedIndex >= draft.fields.length - 1" @click="moveSelected(1)"><ChevronDown :size="16" /></button>
                  <button type="button" title="复制" aria-label="复制字段" :disabled="!selectedField" @click="duplicateSelected"><Copy :size="15" /></button>
                  <button type="button" title="删除" aria-label="删除字段" :disabled="!selectedField" @click="removeSelected"><Trash2 :size="15" /></button>
                </div>
              </div>
              <button
                v-for="(field, index) in draft.fields"
                :key="field.id"
                class="frame-field-row"
                :class="{ selected: field.id === selectedId }"
                type="button"
                @click="selectedId = field.id"
              >
                <span class="frame-field-index">{{ index + 1 }}</span>
                <span class="frame-field-kind">{{ fieldLabel(field) }}</span>
                <strong>{{ field.name || fieldLabel(field) }}</strong>
                <span class="frame-field-value">{{ fieldSummary(field) }}</span>
              </button>
              <div v-if="draft.fields.length === 0" class="frame-empty">从上方添加需要的字段</div>
            </section>

            <section class="frame-property-panel" aria-label="字段属性">
              <template v-if="selectedField">
                <header><span class="eyebrow">FIELD</span><h3>字段属性</h3></header>
                <div class="frame-property-grid">
                  <label class="field span-2"><span>字段名称</span><input v-model="selectedField.name" maxlength="60" /></label>

                  <template v-if="selectedField.kind === 'header' || selectedField.kind === 'frame_id' || selectedField.kind === 'tail'">
                    <label class="field span-2"><span>HEX 值</span><input v-model="selectedField.value" class="mono-input" placeholder="7E" /></label>
                  </template>

                  <template v-else-if="selectedField.kind === 'sequence'">
                    <label class="field"><span>字节长度</span><select v-model="selectedField.byte_length"><option v-for="length in ([1, 2, 3, 4, 8] as const)" :key="length" :value="length">{{ length }} Byte</option></select></label>
                    <label class="field"><span>发送后自增</span><input v-model.number="selectedField.step" type="number" min="1" max="65535" /></label>
                    <label class="field"><span>当前序号 (HEX)</span><input v-model="selectedField.value" class="mono-input" /></label>
                    <label class="field"><span>字节顺序</span><select v-model="selectedField.byte_order"><option value="big">高字节在前</option><option value="little">低字节在前</option></select></label>
                  </template>

                  <template v-else-if="selectedField.kind === 'length'">
                    <label class="field"><span>字节长度</span><select v-model="selectedField.byte_length"><option v-for="length in ([1, 2, 3, 4] as const)" :key="length" :value="length">{{ length }} Byte</option></select></label>
                    <label class="field"><span>字节顺序</span><select v-model="selectedField.byte_order"><option value="big">高字节在前</option><option value="little">低字节在前</option></select></label>
                    <label class="field"><span>统计起始字段</span><select v-model="selectedField.range_start_id"><option :value="null">第一个字段</option><option v-for="option in fieldOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
                    <label class="field"><span>统计结束字段</span><select v-model="selectedField.range_end_id"><option :value="null">最后一个字段</option><option v-for="option in fieldOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
                  </template>

                  <template v-else-if="selectedField.kind === 'data'">
                    <label class="field"><span>数据来源</span><select v-model="selectedField.source" :disabled="selectedField.data_type !== 'hex'"><option value="fixed">固定值</option><option value="editor">发送框数据</option></select></label>
                    <label class="field"><span>数据类型</span><select v-model="selectedField.data_type" @change="updateDataType(selectedField)"><option value="hex">HEX 字节</option><option value="uint">无符号整数</option><option value="int">有符号整数</option><option value="float32">Float32</option><option value="float64">Float64</option></select></label>
                    <label class="field"><span>字节长度</span><select v-model="selectedField.byte_length" :disabled="selectedField.data_type === 'float32' || selectedField.data_type === 'float64'"><option v-if="selectedField.data_type === 'hex'" :value="null">任意长度</option><option v-for="length in ([1, 2, 3, 4, 8] as FrameByteLength[])" :key="length" :value="length">{{ length }} Byte</option></select></label>
                    <label class="field"><span>字节顺序</span><select v-model="selectedField.byte_order"><option value="big">高字节在前</option><option value="little">低字节在前</option></select></label>
                    <label v-if="selectedField.source === 'fixed'" class="field span-2"><span>{{ selectedField.data_type === 'hex' ? 'HEX 值' : '数值' }}</span><input v-model="selectedField.value" class="mono-input" /></label>
                  </template>

                  <template v-else-if="selectedField.kind === 'checksum'">
                    <label class="field span-2"><span>CRC16 类型</span><select v-model="selectedField.parameters.preset" @change="applyCrcPreset(selectedField)"><option v-for="preset in crcPresets" :key="preset.value" :value="preset.value">{{ preset.label }}</option></select></label>
                    <label class="field"><span>校验起始字段</span><select v-model="selectedField.range_start_id"><option :value="null">第一个字段</option><option v-for="option in fieldOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
                    <label class="field"><span>校验结束字段</span><select v-model="selectedField.range_end_id"><option :value="null">校验字段前一项</option><option v-for="option in fieldOptions" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
                    <label class="field"><span>多项式 POLY</span><input v-model="selectedField.parameters.polynomial" class="mono-input" :disabled="selectedField.parameters.preset !== 'custom'" /></label>
                    <label class="field"><span>初始值 INIT</span><input v-model="selectedField.parameters.initial" class="mono-input" :disabled="selectedField.parameters.preset !== 'custom'" /></label>
                    <label class="field"><span>结果异或 XOROUT</span><input v-model="selectedField.parameters.xor_out" class="mono-input" :disabled="selectedField.parameters.preset !== 'custom'" /></label>
                    <label class="field"><span>字节顺序</span><select v-model="selectedField.byte_order"><option value="big">高字节在前</option><option value="little">低字节在前</option></select></label>
                    <label class="settings-toggle"><input v-model="selectedField.parameters.reflect_input" type="checkbox" :disabled="selectedField.parameters.preset !== 'custom'" /><span>输入反转 REFIN</span></label>
                    <label class="settings-toggle"><input v-model="selectedField.parameters.reflect_output" type="checkbox" :disabled="selectedField.parameters.preset !== 'custom'" /><span>输出反转 REFOUT</span></label>
                  </template>
                </div>
              </template>
              <div v-else class="frame-empty">选择一个字段后编辑属性</div>
            </section>
          </div>

          <section class="frame-preview" :class="{ error: previewError }">
            <header><strong>完整帧预览</strong><span v-if="!previewError">{{ previewSize }} Byte</span></header>
            <code>{{ previewError || previewHex || "启用组帧并添加字段后显示预览" }}</code>
          </section>
        </div>

        <footer class="dialog-footer">
          <button class="dialog-button secondary" type="button" @click="close">取消</button>
          <button class="dialog-button primary" type="button" @click="apply">应用配置</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
