import type { EventBroker } from "../src/core/event-broker.js";
import type { DataEvent, ServerEvent } from "../src/core/types.js";

export function nextEvent(
  broker: EventBroker,
  predicate: (event: ServerEvent) => boolean,
  timeoutMs = 2_000,
): Promise<ServerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("等待通信事件超时"));
    }, timeoutMs);
    const unsubscribe = broker.subscribe((event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

export async function nextDataEvent(
  broker: EventBroker,
  direction: "rx" | "tx",
): Promise<DataEvent> {
  return await nextEvent(
    broker,
    (event) => event.type === "data" && event.direction === direction,
  ) as DataEvent;
}

export function waitForSocketData(socket: NodeJS.EventEmitter): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待 Socket 数据超时")), 2_000);
    socket.once("data", (data: Buffer) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}
