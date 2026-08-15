import { describe, expect, it } from "vitest";
import { hexFrameConfigSchema, transportConfigSchema } from "../src/core/schemas.js";

describe("transport schemas", () => {
  it("按 mode 解析 TCP Client", () => {
    expect(transportConfigSchema.parse({
      mode: "tcp_client",
      host: "127.0.0.1",
      port: 9000,
    })).toMatchObject({
      mode: "tcp_client",
      port: 9000,
      connect_timeout: 8,
      auto_reconnect: false,
    });
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

describe("HEX frame schemas", () => {
  it("把旧版 CRC16 校验字段补全为通用 CRC 校验", () => {
    const parsed = hexFrameConfigSchema.parse({
      version: 1,
      id: "legacy-crc",
      enabled: true,
      fields: [{
        id: "crc",
        name: "CRC16-MODBUS",
        kind: "checksum",
        parameters: {
          preset: "modbus",
          polynomial: "8005",
          initial: "FFFF",
          xor_out: "0000",
          reflect_input: true,
          reflect_output: true,
        },
        byte_order: "little",
        range_start_id: null,
        range_end_id: null,
      }],
    });

    expect(parsed.fields[0]).toMatchObject({
      method: "crc",
      byte_length: 2,
      script: "",
      parameters: { width: 16 },
    });
  });

  it("拒绝 CRC 位宽与输出长度不一致以及过长脚本", () => {
    const base = {
      version: 1 as const,
      id: "invalid-checksum",
      enabled: true,
      fields: [{
        id: "crc",
        name: "CRC",
        kind: "checksum" as const,
        method: "crc",
        byte_length: 1,
        parameters: {
          preset: "custom",
          width: 16,
          polynomial: "1021",
          initial: "FFFF",
          xor_out: "0000",
          reflect_input: false,
          reflect_output: false,
        },
        script: "",
        byte_order: "big",
        range_start_id: null,
        range_end_id: null,
      }],
    };
    expect(() => hexFrameConfigSchema.parse(base)).toThrow("CRC 输出长度");
    expect(() => hexFrameConfigSchema.parse({
      ...base,
      fields: [{ ...base.fields[0], method: "custom_js", script: "x".repeat(16_385) }],
    })).toThrow();
  });
});
