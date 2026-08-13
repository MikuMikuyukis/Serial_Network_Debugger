import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { LogItem, PeriodicSendStatus, ReceivedFrame, ServerEvent, TransportStatus } from "../types";

const MAX_LOGS = 5_000;
const FLUSH_INTERVAL_MS = 50;
const MAX_RECEIVED_FRAMES = 1_000;

const EMPTY_STATUS: TransportStatus = {
  connected: false,
  mode: null,
  rx_bytes: 0,
  tx_bytes: 0,
  details: {},
};

const EMPTY_PERIODIC_STATUS: PeriodicSendStatus = {
  active: false,
  interval_ms: null,
  sent_count: 0,
  started_at: null,
  last_sent_at: null,
  frame_sequences: null,
};

function eventTime(timestamp?: string): string {
  if (!timestamp) return new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf())
    ? timestamp.slice(11, 23)
    : date.toLocaleTimeString("zh-CN", { hour12: false, fractionalSecondDigits: 3 });
}

export function useCommunication(onError: (message: string) => void) {
  const status = ref<TransportStatus>({ ...EMPTY_STATUS });
  const periodicStatus = ref<PeriodicSendStatus>({ ...EMPTY_PERIODIC_STATUS });
  const logs = shallowRef<LogItem[]>([]);
  const receivedFrames = shallowRef<ReceivedFrame[]>([]);
  const paused = ref(false);
  const eventsConnected = ref(false);
  const pending: LogItem[] = [];
  const pendingFrames: ReceivedFrame[] = [];
  let nextLogId = 1;
  let nextFrameId = 1;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let flushTimer: number | undefined;
  let stopped = false;

  function applyStatus(nextStatus: TransportStatus): void {
    status.value = nextStatus;
  }

  function applyPeriodicStatus(nextStatus: PeriodicSendStatus): void {
    periodicStatus.value = nextStatus;
  }

  function queueEvent(event: ServerEvent): void {
    if (event.type === "status") {
      applyStatus(event.status);
      return;
    }
    if (event.type === "periodic_status") {
      applyPeriodicStatus(event.status);
      return;
    }
    if (event.type === "ping") return;

    if (event.type === "data") {
      if (event.direction === "rx") {
        pendingFrames.push({
          id: nextFrameId++,
          timestamp: event.timestamp ?? new Date().toISOString(),
          hex: event.hex,
          peer: event.peer ?? "",
          size: event.size,
        });
      }
      if (paused.value) return;
      pending.push({
        id: nextLogId++,
        time: eventTime(event.timestamp),
        kind: event.direction,
        text: event.text,
        hex: event.hex,
        peer: event.peer ?? "",
        size: event.size,
      });
      return;
    }

    if (paused.value) return;

    pending.push({
      id: nextLogId++,
      time: eventTime(event.timestamp),
      kind: event.type === "error" ? "error" : "info",
      text: event.message,
      hex: event.message,
      peer: "",
      size: 0,
    });
    if (event.type === "error") onError(event.message);
  }

  function flushLogs(): void {
    if (pending.length > 0) {
      const merged = logs.value.concat(pending.splice(0, pending.length));
      logs.value = merged.length > MAX_LOGS ? merged.slice(-MAX_LOGS) : merged;
    }
    if (pendingFrames.length > 0) {
      const merged = receivedFrames.value.concat(pendingFrames.splice(0, pendingFrames.length));
      receivedFrames.value = merged.length > MAX_RECEIVED_FRAMES ? merged.slice(-MAX_RECEIVED_FRAMES) : merged;
    }
  }

  function clearLogs(): void {
    pending.length = 0;
    logs.value = [];
  }

  function connectEvents(): void {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const nextSocket = new WebSocket(`${scheme}://${window.location.host}/ws/events`);
    socket = nextSocket;

    nextSocket.addEventListener("open", () => {
      eventsConnected.value = true;
    });

    nextSocket.addEventListener("message", (message) => {
      try {
        queueEvent(JSON.parse(message.data as string) as ServerEvent);
      } catch {
        // A malformed server event should not break later updates.
      }
    });
    nextSocket.addEventListener("close", () => {
      eventsConnected.value = false;
      if (stopped || socket !== nextSocket) return;
      reconnectTimer = window.setTimeout(connectEvents, 1_500);
    });
    nextSocket.addEventListener("error", () => {
      eventsConnected.value = false;
    });
  }

  onMounted(() => {
    connectEvents();
    flushTimer = window.setInterval(flushLogs, FLUSH_INTERVAL_MS);
  });

  onBeforeUnmount(() => {
    stopped = true;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    if (flushTimer !== undefined) window.clearInterval(flushTimer);
    socket?.close();
  });

  return {
    status,
    periodicStatus,
    logs,
    receivedFrames,
    paused,
    eventsConnected,
    applyStatus,
    applyPeriodicStatus,
    clearLogs,
  };
}
