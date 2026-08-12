import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBroker } from "../src/core/event-broker.js";
import { PeriodicSender } from "../src/core/periodic-sender.js";

describe("periodic sender", () => {
  afterEach(() => vi.useRealTimers());

  it("立即发送并按间隔串行重复，停止后不再发送", async () => {
    vi.useFakeTimers();
    const payloads: string[] = [];
    const sender = new PeriodicSender({
      send: async (data) => { payloads.push(data.toString()); },
    }, new EventBroker());

    const started = await sender.start(Buffer.from("tick"), 100);
    expect(started).toMatchObject({ active: true, sent_count: 1, interval_ms: 100 });
    await vi.advanceTimersByTimeAsync(300);
    expect(payloads).toEqual(["tick", "tick", "tick", "tick"]);
    expect(sender.snapshot().sent_count).toBe(4);

    sender.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(payloads).toHaveLength(4);
    expect(sender.snapshot()).toMatchObject({ active: false, sent_count: 0 });
  });

  it("发送失败时停止任务并发布错误", async () => {
    vi.useFakeTimers();
    const broker = new EventBroker();
    const errors: string[] = [];
    broker.subscribe((event) => {
      if (event.type === "error") errors.push(event.message);
    });
    let count = 0;
    const sender = new PeriodicSender({
      send: async () => {
        count += 1;
        if (count === 2) throw new Error("write failed");
      },
    }, broker);

    await sender.start(Buffer.from("tick"), 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(sender.snapshot().active).toBe(false);
    expect(errors).toContain("周期发送已停止：write failed");
  });
});
