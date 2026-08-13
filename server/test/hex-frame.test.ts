import { describe, expect, it } from "vitest";
import { buildHexFrame, crc16, CRC16_PRESETS, HexFrameSession } from "../src/core/hex-frame.js";
import type { HexFrameConfig } from "../src/core/types.js";

describe("HEX frame builder", () => {
  it.each([
    ["modbus", 0x4b37],
    ["arc", 0xbb3d],
    ["ccitt_false", 0x29b1],
    ["xmodem", 0x31c3],
    ["x25", 0x906e],
    ["kermit", 0x2189],
  ] as const)("计算 CRC16-%s 标准校验向量", (preset, expected) => {
    expect(crc16(Buffer.from("123456789"), { preset, ...CRC16_PRESETS[preset] })).toBe(expected);
  });

  it("按用户字段顺序组帧并计算长度、序号和 CRC", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "frame-1",
      enabled: true,
      fields: [
        { id: "head", kind: "header", name: "帧头", value: "7E" },
        { id: "seq", kind: "sequence", name: "序号", byte_length: 1, value: "FE", step: 1, byte_order: "big" },
        { id: "id", kind: "frame_id", name: "功能码", value: "A4" },
        { id: "len", kind: "length", name: "帧长度", byte_length: 2, byte_order: "little", range_start_id: "data", range_end_id: "tail" },
        { id: "data", kind: "data", name: "发送框数据", byte_length: null, source: "editor", data_type: "hex", value: "", byte_order: "big" },
        {
          id: "crc",
          kind: "checksum",
          name: "MODBUS",
          parameters: { preset: "modbus", ...CRC16_PRESETS.modbus },
          byte_order: "little",
          range_start_id: "head",
          range_end_id: "data",
        },
        { id: "tail", kind: "tail", name: "帧尾", value: "0D 0A" },
      ],
    };

    const result = buildHexFrame(config, "11 22");
    expect(result.data.subarray(0, 7).toString("hex").toUpperCase()).toBe("7EFEA406001122");
    expect(result.data.subarray(-2).toString("hex").toUpperCase()).toBe("0D0A");
    expect(result.nextSequences).toEqual({ seq: "FF" });
  });

  it("允许字段重复、任意排序并按小端存放定长数据", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "free-order",
      enabled: true,
      fields: [
        { id: "d1", kind: "data", name: "2Byte", byte_length: 2, source: "fixed", data_type: "hex", value: "1234", byte_order: "little" },
        { id: "head", kind: "header", name: "中间帧头", value: "7E" },
        { id: "d2", kind: "data", name: "2Byte", byte_length: 2, source: "fixed", data_type: "hex", value: "ABCD", byte_order: "big" },
      ],
    };
    expect(buildHexFrame(config, "").data.toString("hex").toUpperCase()).toBe("34127EABCD");
  });

  it("序号按字段宽度回绕", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "sequence-wrap",
      enabled: true,
      fields: [
        { id: "seq", kind: "sequence", name: "序号", byte_length: 1, value: "FF", step: 1, byte_order: "big" },
      ],
    };
    expect(buildHexFrame(config, "").nextSequences).toEqual({ seq: "00" });
  });

  it("编码有符号整数和 Float32 数据字段", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "typed-data",
      enabled: true,
      fields: [
        { id: "int", kind: "data", name: "温度", byte_length: 2, source: "fixed", data_type: "int", value: "-2", byte_order: "little" },
        { id: "float", kind: "data", name: "速度", byte_length: 4, source: "fixed", data_type: "float32", value: "1.5", byte_order: "big" },
      ],
    };
    expect(buildHexFrame(config, "").data.toString("hex").toUpperCase()).toBe("FEFF3FC00000");
  });

  it("长度统计允许包含长度字段自身", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "self-length",
      enabled: true,
      fields: [
        { id: "length", kind: "length", name: "整帧长度", byte_length: 2, byte_order: "big", range_start_id: "length", range_end_id: "data" },
        { id: "data", kind: "data", name: "数据", byte_length: 1, source: "fixed", data_type: "hex", value: "AA", byte_order: "big" },
      ],
    };
    expect(buildHexFrame(config, "").data.toString("hex").toUpperCase()).toBe("0003AA");
  });

  it("拒绝 CRC16 校验区间引用尚未计算的后续 CRC16", () => {
    const parameters = { preset: "modbus" as const, ...CRC16_PRESETS.modbus };
    const config: HexFrameConfig = {
      version: 1,
      id: "future-crc",
      enabled: true,
      fields: [
        { id: "head", kind: "header", name: "帧头", value: "AA" },
        { id: "crc-1", kind: "checksum", name: "第一段 CRC", parameters, byte_order: "little", range_start_id: "crc-2", range_end_id: "crc-2" },
        { id: "crc-2", kind: "checksum", name: "第二段 CRC", parameters, byte_order: "little", range_start_id: "head", range_end_id: "head" },
      ],
    };
    expect(() => buildHexFrame(config, "")).toThrow("后续 CRC16");
  });

  it("发送成功后才提交序号，失败发送不递增", async () => {
    const session = new HexFrameSession();
    const config: HexFrameConfig = {
      version: 1,
      id: "session-sequence",
      enabled: true,
      fields: [
        { id: "sequence", kind: "sequence", name: "序号", byte_length: 1, value: "10", step: 1, byte_order: "big" },
      ],
    };

    await expect(session.send(config, "", async () => { throw new Error("write failed"); })).rejects.toThrow("write failed");
    expect(session.preview(config, "").data.toString("hex").toUpperCase()).toBe("10");

    await session.send(config, "", async () => undefined);
    expect(session.preview(config, "").data.toString("hex").toUpperCase()).toBe("11");
  });
});
