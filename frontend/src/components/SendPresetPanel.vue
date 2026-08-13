<script setup lang="ts">
import { Download, ListStart, Plus, Send, Settings, Square, Trash2, X } from "@lucide/vue";
import {
  compactHexDisplay,
  deleteAcrossHexDisplaySpace,
  formatHexDisplay,
  hexDisplayCaret,
  MAX_HEX_DISPLAY_LENGTH,
} from "../hex-display";
import type { SendPreset, SendPresetDraft } from "../types";
import FrameGeneratedControls from "./FrameGeneratedControls.vue";

defineProps<{
  presets: SendPreset[];
  presetFramePreviews: Record<string, { hex: string; error: string; loading: boolean }>;
  connected: boolean;
  open: boolean;
  editorLocked: boolean;
  sendingPresetId: string | null;
  sequenceRunning: boolean;
}>();

const emit = defineEmits<{
  close: [];
  add: [];
  update: [id: string, changes: Partial<SendPresetDraft>];
  remove: [preset: SendPreset];
  load: [preset: SendPreset];
  send: [preset: SendPreset];
  "edit-frame": [preset: SendPreset];
  "update-generated": [presetId: string, fieldId: string, value: string];
  "commit-generated": [presetId: string];
  "toggle-sequence": [];
}>();

function hasIndependentFramePayload(preset: SendPreset): boolean {
  const config = preset.frame_config;
  return Boolean(config?.enabled && config.fields.some((field) => {
    if (field.kind === "sequence" || field.kind === "length" || field.kind === "checksum") return true;
    if (field.kind === "data" && field.source === "editor") return false;
    return field.value.trim().length > 0;
  }));
}

function canSendPreset(preset: SendPreset): boolean {
  return preset.data.length > 0 || (preset.format === "hex" && hasIndependentFramePayload(preset));
}

function hasGeneratedControls(preset: SendPreset): boolean {
  return Boolean(preset.frame_config?.enabled && preset.frame_config.fields.some(
    (field) => field.kind === "data" && field.source === "generated" && field.generator?.control !== "none",
  ));
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function checkedValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function numberValue(event: Event): number {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  return Number.isFinite(value) ? Math.min(86_400_000, Math.max(0, Math.round(value))) : 50;
}

function hasEnabledFrame(preset: SendPreset): boolean {
  return preset.format === "hex" && Boolean(preset.frame_config?.enabled);
}

function displayedPresetData(
  preset: SendPreset,
  previews: Record<string, { hex: string; error: string; loading: boolean }>,
): string {
  if (hasEnabledFrame(preset)) return previews[preset.id]?.hex ?? "";
  return preset.format === "hex" ? formatHexDisplay(preset.data) : preset.data;
}

function presetDataPlaceholder(
  preset: SendPreset,
  previews: Record<string, { hex: string; error: string; loading: boolean }>,
): string {
  if (!hasEnabledFrame(preset)) return preset.format === "hex" ? "AA 55 01 00" : "输入发送内容";
  const preview = previews[preset.id];
  if (preview?.error) return preview.error;
  return preview?.loading ? "正在生成完整帧..." : "完整帧为空";
}

function presetDataMaxlength(preset: SendPreset): number {
  return preset.format === "hex" ? MAX_HEX_DISPLAY_LENGTH : 1_048_576;
}

function updatePresetData(preset: SendPreset, event: Event): void {
  if (hasEnabledFrame(preset)) return;
  const target = event.target as HTMLInputElement;
  if (preset.format !== "hex") {
    emit("update", preset.id, { data: target.value });
    return;
  }

  const rawOffset = compactHexDisplay(target.value.slice(0, target.selectionStart ?? 0)).length;
  const compactValue = compactHexDisplay(target.value);
  target.value = formatHexDisplay(compactValue);
  emit("update", preset.id, { data: compactValue });
  const caret = hexDisplayCaret(rawOffset, compactValue.length);
  target.setSelectionRange(caret, caret);
}

function handlePresetDataKeydown(preset: SendPreset, event: KeyboardEvent): void {
  if (hasEnabledFrame(preset) || preset.format !== "hex" || (event.key !== "Backspace" && event.key !== "Delete")) return;

  const target = event.target as HTMLInputElement;
  if (target.selectionStart === null || target.selectionEnd === null) return;
  if (target.selectionStart !== target.selectionEnd) return;
  const edit = deleteAcrossHexDisplaySpace(
    target.value,
    target.selectionStart,
    event.key === "Backspace" ? "backward" : "forward",
  );
  if (!edit) return;

  event.preventDefault();
  target.value = formatHexDisplay(edit.value);
  emit("update", preset.id, { data: edit.value });
  target.setSelectionRange(edit.caret, edit.caret);
}
</script>

<template>
  <aside class="preset-panel" :class="{ open }" aria-label="发送预设">
    <header class="preset-header">
      <div>
        <strong>发送预设</strong>
        <span>{{ presets.length }}</span>
      </div>
      <div class="preset-header-actions">
        <button
          class="preset-sequence-button"
          :class="{ stop: sequenceRunning }"
          type="button"
          :disabled="!sequenceRunning && (!connected || !presets.some((preset) => preset.enabled && canSendPreset(preset)))"
          @click="emit('toggle-sequence')"
        >
          <Square v-if="sequenceRunning" :size="13" />
          <ListStart v-else :size="15" />
          <span>{{ sequenceRunning ? "停止队列" : "发送启用项" }}</span>
        </button>
        <button class="preset-add-button" type="button" @click="emit('add')">
          <Plus :size="15" />
          <span>添加</span>
        </button>
        <button class="icon-tool-button" type="button" title="关闭预设列表" aria-label="关闭预设列表" @click="emit('close')">
          <X :size="16" />
        </button>
      </div>
    </header>

    <div class="preset-table-wrap">
      <table class="preset-table">
        <thead>
          <tr>
            <th class="preset-col-enabled">启用</th>
            <th class="preset-col-name">名称</th>
            <th>发送内容</th>
            <th class="preset-col-format">格式</th>
            <th class="preset-col-delay">延时</th>
            <th class="preset-col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(preset, index) in presets" :key="preset.id">
          <tr :class="{ disabled: !preset.enabled }">
            <td class="preset-col-enabled">
              <label class="preset-check" :title="preset.enabled ? '禁用此预设' : '启用此预设'">
                <input
                  type="checkbox"
                  :checked="preset.enabled"
                  @change="emit('update', preset.id, { enabled: checkedValue($event) })"
                />
                <span>{{ index + 1 }}</span>
              </label>
            </td>
            <td class="preset-col-name">
              <input
                class="preset-cell-input preset-name-input"
                :value="preset.name"
                maxlength="60"
                placeholder="未命名"
                title="预设名称"
                @input="emit('update', preset.id, { name: inputValue($event) })"
              />
            </td>
            <td>
              <input
                class="preset-cell-input preset-data-input"
                :class="{ 'frame-preview-value': hasEnabledFrame(preset), error: presetFramePreviews[preset.id]?.error }"
                :value="displayedPresetData(preset, presetFramePreviews)"
                :maxlength="presetDataMaxlength(preset)"
                :placeholder="presetDataPlaceholder(preset, presetFramePreviews)"
                :title="hasEnabledFrame(preset) ? (presetFramePreviews[preset.id]?.error || '当前完整组包内容') : '发送内容'"
                :readonly="hasEnabledFrame(preset)"
                @input="updatePresetData(preset, $event)"
                @keydown="handlePresetDataKeydown(preset, $event)"
              />
            </td>
            <td class="preset-col-format">
              <div class="preset-format-controls">
                <label class="preset-hex-toggle" title="HEX 发送">
                  <input
                    type="checkbox"
                    :checked="preset.format === 'hex'"
                    @change="emit('update', preset.id, { format: checkedValue($event) ? 'hex' : 'text' })"
                  />
                  <span>HEX</span>
                </label>
                <select
                  v-if="preset.format === 'text'"
                  :value="preset.text_encoding"
                  title="文本编码"
                  @change="emit('update', preset.id, { text_encoding: selectValue($event) as 'utf-8' | 'ascii' | 'gbk' })"
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="ascii">ASCII</option>
                  <option value="gbk">GBK</option>
                </select>
                <select
                  :value="preset.line_ending"
                  title="行尾"
                  @change="emit('update', preset.id, { line_ending: selectValue($event) as 'none' | 'cr' | 'lf' | 'crlf' })"
                >
                  <option value="none">无行尾</option>
                  <option value="crlf">CRLF</option>
                  <option value="lf">LF</option>
                  <option value="cr">CR</option>
                </select>
              </div>
            </td>
            <td class="preset-col-delay">
              <label class="preset-delay-field">
                <input
                  type="number"
                  min="0"
                  max="86400000"
                  step="10"
                  :value="preset.delay_ms"
                  title="预设序列延时"
                  @change="emit('update', preset.id, { delay_ms: numberValue($event) })"
                />
                <span>ms</span>
              </label>
            </td>
            <td class="preset-col-actions">
              <div class="preset-actions">
                <button
                  class="preset-action"
                  type="button"
                  title="载入发送区"
                  aria-label="载入发送区"
                  :disabled="editorLocked"
                  @click="emit('load', preset)"
                >
                  <Download :size="15" />
                </button>
                <button
                  class="preset-action frame"
                  :class="{ active: preset.frame_config?.enabled }"
                  type="button"
                  :title="preset.frame_config?.enabled ? `编辑 HEX 帧（${preset.frame_config.fields.length} 字段）` : '配置该预设的 HEX 帧'"
                  aria-label="编辑预设 HEX 帧"
                  :disabled="editorLocked"
                  @click="emit('edit-frame', preset)"
                >
                  <Settings :size="15" />
                </button>
                <button
                  class="preset-action send"
                  type="button"
                  title="立即发送"
                  aria-label="立即发送"
                  :disabled="!connected || !canSendPreset(preset) || sendingPresetId !== null"
                  @click="emit('send', preset)"
                >
                  <Send :size="15" />
                </button>
                <button
                  class="preset-action danger"
                  type="button"
                  title="删除预设"
                  aria-label="删除预设"
                  @click="emit('remove', preset)"
                >
                  <Trash2 :size="15" />
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="hasGeneratedControls(preset)" class="preset-generated-row" :class="{ disabled: !preset.enabled }">
            <td></td>
            <td colspan="5">
              <div class="preset-generated-tools">
                <label class="toggle" title="生成控件操作完成后自动发送一次">
                  <input
                    type="checkbox"
                    :checked="preset.auto_send_on_change"
                    @change="emit('update', preset.id, { auto_send_on_change: checkedValue($event) })"
                  />
                  <span>帧变化自动发送</span>
                </label>
                <span v-if="preset.auto_send_on_change && !connected">等待连接</span>
              </div>
              <FrameGeneratedControls
                :config="preset.frame_config"
                :disabled="editorLocked || !preset.enabled"
                compact
                @update="(fieldId, value) => emit('update-generated', preset.id, fieldId, value)"
                @commit="() => emit('commit-generated', preset.id)"
              />
            </td>
          </tr>
          </template>
          <tr v-if="presets.length === 0" class="preset-empty-row">
            <td colspan="6">
              <button type="button" @click="emit('add')"><Plus :size="15" />添加第一条预设</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </aside>
</template>
