import { afterEach, describe, expect, it, vi } from "vitest";
import { SerialReceiveBuffer } from "../src/transports/serial.js";

describe("serial receive buffer", () => {
  afterEach(() => vi.useRealTimers());

  it("将空闲间隔内的底层读取块合并为一条数据", () => {
    vi.useFakeTimers();
    const received: Buffer[] = [];
    const buffer = new SerialReceiveBuffer(20, (data) => received.push(data));
    buffer.append(Buffer.from("T"));
    vi.advanceTimersByTime(10);
    buffer.append(Buffer.from("e"));
    vi.advanceTimersByTime(10);
    buffer.append(Buffer.from("st_DATA"));
    vi.advanceTimersByTime(19);
    expect(received).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(received.map((data) => data.toString())).toEqual(["Test_DATA"]);
  });

  it("空闲后输出当前数据", () => {
    vi.useFakeTimers();
    const received: Buffer[] = [];
    const buffer = new SerialReceiveBuffer(5, (data) => received.push(data));
    buffer.append(Buffer.from("first"));
    vi.advanceTimersByTime(5);
    expect(received[0]?.toString()).toBe("first");
  });

  it("达到最大块大小时立即输出", () => {
    const received: Buffer[] = [];
    const buffer = new SerialReceiveBuffer(20, (data) => received.push(data), 4);
    buffer.append(Buffer.from("abcdef"));
    expect(received.map((data) => data.toString())).toEqual(["abcd"]);
    buffer.flush();
    expect(received.map((data) => data.toString())).toEqual(["abcd", "ef"]);
  });
});
