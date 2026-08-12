import { describe, expect, it } from "vitest";
import { transportConfigSchema } from "../src/core/schemas.js";

describe("transport schemas", () => {
  it("按 mode 解析 TCP Client", () => {
    expect(transportConfigSchema.parse({
      mode: "tcp_client",
      host: "127.0.0.1",
      port: 9000,
    })).toMatchObject({ mode: "tcp_client", port: 9000, connect_timeout: 8 });
  });

  it("串口接收合并间隔默认 20 ms", () => {
    expect(transportConfigSchema.parse({ mode: "serial", port: "COM3" }))
      .toMatchObject({ receive_idle_ms: 20, baudrate: 115_200 });
  });

  it.each([0, 1001])("限制串口合并间隔：%d", (receive_idle_ms) => {
    expect(() => transportConfigSchema.parse({ mode: "serial", port: "COM3", receive_idle_ms }))
      .toThrow();
  });

  it("要求 UDP 远端地址与端口成对配置", () => {
    expect(() => transportConfigSchema.parse({
      mode: "udp",
      local_host: "127.0.0.1",
      local_port: 0,
      remote_host: "127.0.0.1",
    })).toThrow("UDP 远端地址和端口必须同时填写或同时留空");
  });
});
