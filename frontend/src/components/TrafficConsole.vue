<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Eraser, Pause, Play, Send } from "@lucide/vue";
import { apiRequest } from "../api";
import type { DataFormat, LineEnding, LogItem, SendPayload, TextEncoding } from "../types";
import VirtualLog from "./VirtualLog.vue";

const props = defineProps<{
  connected: boolean;
  eventsConnected: boolean;
  logs: LogItem[];
  paused: boolean;
}>();

const emit = defineEmits<{
  error: [message: string];
  clear: [];
  "update:paused": [paused: boolean];
}>();

const displayHex = ref(false);
const autoScroll = ref(true);
const format = ref<DataFormat>("text");
const textEncoding = ref<TextEncoding>("utf-8");
const lineEnding = ref<LineEnding>("none");
const sendData = ref("");
const sending = ref(false);
const placeholder = computed(() =>
  format.value === "hex" ? "AA 55 01 00" : "输入发送内容",
);

watch(format, (value) => {
  if (value === "hex") displayHex.value = true;
});

async function send(): Promise<void> {
  sending.value = true;
  try {
    const payload: SendPayload = {
      data: sendData.value,
      format: format.value,
      text_encoding: textEncoding.value,
      line_ending: lineEnding.value,
    };
    await apiRequest<{ ok: boolean; message: string }>("/api/send", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    emit("error", error instanceof Error ? error.message : "发送失败");
  } finally {
    sending.value = false;
  }
}

function handleSendShortcut(event: KeyboardEvent): void {
  if (event.key !== "Enter" || !event.ctrlKey) return;
  event.preventDefault();
  if (props.connected && !sending.value) void send();
}
</script>

<template>
  <section class="console-area">
    <div class="console-toolbar">
      <div>
        <span class="eyebrow">LIVE TRAFFIC</span>
        <h2>通信日志</h2>
        <span class="event-channel" :class="{ online: eventsConnected }">
          <span class="event-channel-dot"></span>
          {{ eventsConnected ? "实时通道已连接" : "实时通道正在重连" }}
        </span>
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

    <VirtualLog :logs="logs" :display-hex="displayHex" :auto-scroll="autoScroll" />

    <form class="send-panel" @submit.prevent="send">
      <div class="send-options">
        <div class="segmented" aria-label="发送格式">
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
      <div class="send-row">
        <textarea v-model="sendData" rows="3" :placeholder="placeholder" @keydown="handleSendShortcut"></textarea>
        <button class="button button-send" type="submit" :disabled="sending || !connected">
          <Send :size="17" />
          <span>发送</span>
        </button>
      </div>
    </form>
  </section>
</template>
