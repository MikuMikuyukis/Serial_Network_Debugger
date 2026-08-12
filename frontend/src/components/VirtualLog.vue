<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { LogItem } from "../types";

const ROW_HEIGHT = 29;
const OVERSCAN = 12;

const props = defineProps<{
  logs: LogItem[];
  displayHex: boolean;
  autoScroll: boolean;
}>();

const viewport = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(400);
const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN));
const visibleCount = computed(() => Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2);
const visibleLogs = computed(() => props.logs.slice(startIndex.value, startIndex.value + visibleCount.value));
const totalHeight = computed(() => props.logs.length * ROW_HEIGHT);
const offsetY = computed(() => startIndex.value * ROW_HEIGHT);

function onScroll(): void {
  if (!viewport.value) return;
  scrollTop.value = viewport.value.scrollTop;
  viewportHeight.value = viewport.value.clientHeight;
}

async function scrollToBottom(): Promise<void> {
  if (!props.autoScroll) return;
  await nextTick();
  if (viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight;
}

watch(() => props.logs.length, scrollToBottom);
onMounted(() => {
  onScroll();
  new ResizeObserver(onScroll).observe(viewport.value!);
});
</script>

<template>
  <div ref="viewport" class="log-viewport" @scroll="onScroll">
    <div v-if="logs.length === 0" class="empty-log">
      <strong>等待通信数据</strong>
    </div>
    <div class="virtual-log-space" :style="{ height: `${totalHeight}px` }">
      <div class="virtual-log-window" :style="{ transform: `translateY(${offsetY}px)` }">
        <div v-for="item in visibleLogs" :key="item.id" class="log-row" :title="displayHex ? item.hex : item.text">
          <span class="log-time">{{ item.time }}</span>
          <span class="log-dir" :class="item.kind">
            {{ { rx: "RX", tx: "TX", info: "··", error: "!!" }[item.kind] }}
          </span>
          <span class="log-value">
            {{ item.kind === "rx" || item.kind === "tx" ? (displayHex ? item.hex : item.text || "(空数据)") : item.text }}
            <span v-if="item.peer" class="log-peer">[{{ item.peer }}]</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
