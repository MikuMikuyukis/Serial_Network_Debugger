<script setup lang="ts">
import { computed, ref } from "vue";
import { FileInput, Pencil, Plus, Send, Trash2, X } from "@lucide/vue";
import type { SendPayload, SendPreset, SendPresetDraft } from "../types";

const props = defineProps<{
  presets: SendPreset[];
  connected: boolean;
  open: boolean;
  editorPayload: SendPayload;
  editorLocked: boolean;
  sendingPresetId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [id: string | null, draft: SendPresetDraft];
  remove: [preset: SendPreset];
  load: [preset: SendPreset];
  send: [preset: SendPreset];
}>();

const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const name = ref("");
const data = ref("");
const format = ref<SendPayload["format"]>("text");
const textEncoding = ref<SendPayload["text_encoding"]>("utf-8");
const lineEnding = ref<SendPayload["line_ending"]>("none");
const dialogTitle = computed(() => editingId.value ? "编辑发送预设" : "新增发送预设");

function openCreate(): void {
  editingId.value = null;
  name.value = "";
  applyPayload(props.editorPayload);
  dialogOpen.value = true;
}

function openEdit(preset: SendPreset): void {
  editingId.value = preset.id;
  name.value = preset.name;
  applyPayload(preset);
  dialogOpen.value = true;
}

function applyPayload(payload: SendPayload): void {
  data.value = payload.data;
  format.value = payload.format;
  textEncoding.value = payload.text_encoding;
  lineEnding.value = payload.line_ending;
}

function closeDialog(): void {
  dialogOpen.value = false;
}

function save(): void {
  const normalizedName = name.value.trim();
  if (!normalizedName || data.value.length === 0) return;
  emit("save", editingId.value, {
    name: normalizedName,
    data: data.value,
    format: format.value,
    text_encoding: textEncoding.value,
    line_ending: lineEnding.value,
  });
  closeDialog();
}

function preview(preset: SendPreset): string {
  return preset.data.replace(/[\r\n\t]+/g, " ") || "(空内容)";
}

function formatLabel(preset: SendPreset): string {
  return `${preset.format === "hex" ? "HEX" : preset.text_encoding.toUpperCase()} · ${preset.line_ending.toUpperCase()}`;
}

function confirmRemove(preset: SendPreset): void {
  if (window.confirm(`确定删除预设“${preset.name}”吗？`)) emit("remove", preset);
}

defineExpose({ openCreate });
</script>

<template>
  <aside class="preset-panel" :class="{ open }" aria-label="发送预设">
    <header class="preset-header">
      <div>
        <strong>发送预设</strong>
        <span>{{ presets.length }}</span>
      </div>
      <div class="preset-header-actions">
        <button class="icon-tool-button" type="button" title="新增预设" aria-label="新增预设" @click="openCreate">
          <Plus :size="16" />
        </button>
        <button class="icon-tool-button preset-close" type="button" title="关闭预设列表" aria-label="关闭预设列表" @click="emit('close')">
          <X :size="16" />
        </button>
      </div>
    </header>

    <div v-if="presets.length" class="preset-list">
      <article v-for="preset in presets" :key="preset.id" class="preset-item">
        <div class="preset-copy">
          <strong :title="preset.name">{{ preset.name }}</strong>
          <span class="preset-meta">{{ formatLabel(preset) }}</span>
          <code :title="preset.data">{{ preview(preset) }}</code>
        </div>
        <div class="preset-actions">
          <button
            class="preset-action load"
            type="button"
            title="载入发送区"
            aria-label="载入发送区"
            :disabled="editorLocked"
            @click="emit('load', preset)"
          >
            <FileInput :size="15" />
          </button>
          <button
            class="preset-action send"
            type="button"
            title="立即发送"
            aria-label="立即发送"
            :disabled="!connected || sendingPresetId !== null"
            @click="emit('send', preset)"
          >
            <Send :size="15" />
          </button>
          <button class="preset-action" type="button" title="编辑预设" aria-label="编辑预设" @click="openEdit(preset)">
            <Pencil :size="15" />
          </button>
          <button class="preset-action danger" type="button" title="删除预设" aria-label="删除预设" @click="confirmRemove(preset)">
            <Trash2 :size="15" />
          </button>
        </div>
      </article>
    </div>
    <div v-else class="preset-empty">
      <strong>暂无发送预设</strong>
      <button type="button" @click="openCreate"><Plus :size="15" />新增预设</button>
    </div>
  </aside>

  <Teleport to="body">
    <div v-if="dialogOpen" class="modal-backdrop" @click.self="closeDialog" @keydown.esc="closeDialog">
      <form class="preset-dialog" @submit.prevent="save">
        <header class="dialog-header">
          <div>
            <span class="eyebrow">SEND PRESET</span>
            <h2>{{ dialogTitle }}</h2>
          </div>
          <button class="icon-tool-button" type="button" title="关闭" aria-label="关闭" @click="closeDialog">
            <X :size="17" />
          </button>
        </header>
        <div class="dialog-body">
          <label class="field">
            <span>名称</span>
            <input v-model="name" maxlength="60" required autofocus placeholder="例如：读取设备信息" />
          </label>
          <div class="preset-format-row">
            <div class="segmented" aria-label="预设格式">
              <label><input v-model="format" type="radio" value="text" /><span>文本</span></label>
              <label><input v-model="format" type="radio" value="hex" /><span>HEX</span></label>
            </div>
            <label class="compact-field">
              <span>编码</span>
              <select v-model="textEncoding" :disabled="format === 'hex'">
                <option value="utf-8">UTF-8</option>
                <option value="ascii">ASCII</option>
                <option value="gbk">GBK</option>
              </select>
            </label>
            <label class="compact-field">
              <span>行尾</span>
              <select v-model="lineEnding">
                <option value="none">无</option>
                <option value="crlf">CRLF</option>
                <option value="lf">LF</option>
                <option value="cr">CR</option>
              </select>
            </label>
          </div>
          <label class="field preset-data-field">
            <span>发送内容</span>
            <textarea
              v-model="data"
              rows="6"
              maxlength="1048576"
              required
              :placeholder="format === 'hex' ? 'AA 55 01 00' : '输入发送内容'"
            ></textarea>
          </label>
        </div>
        <footer class="dialog-footer">
          <button class="dialog-button secondary" type="button" @click="closeDialog">取消</button>
          <button class="dialog-button primary" type="submit" :disabled="!name.trim() || data.length === 0">保存</button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>
