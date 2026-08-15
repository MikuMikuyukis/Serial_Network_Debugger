import { describe, expect, it } from "vitest";
import { buildHexFrame, crc, crc16, CRC_PRESETS, CRC16_PRESETS, HexFrameSession } from "../src/core/hex-frame.js";
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

  it.each([
    ["crc8", 0xf4],
    ["crc8_maxim", 0xa1],
    ["crc32", 0xcbf4_3926],
    ["crc32_mpeg2", 0x0376_e6e7],
  ] as const)("计算 %s 标准校验向量", (preset, expected) => {
    expect(crc(Buffer.from("123456789"), { preset, ...CRC_PRESETS[preset] })).toBe(expected);
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
          method: "crc",
          byte_length: 2,
          parameters: { preset: "modbus", ...CRC16_PRESETS.modbus },
          script: "",
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

  it("把字符串编码为 HEX 帧载荷并按实际字节数填写长度", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "text-payload",
      enabled: true,
      fields: [
        { id: "head", kind: "header", name: "帧头", value: "AA" },
        { id: "length", kind: "length", name: "字符串长度", byte_length: 1, byte_order: "big", range_start_id: "payload", range_end_id: "payload" },
        { id: "payload", kind: "data", name: "字符串载荷", byte_length: null, source: "fixed", data_type: "text", text_encoding: "utf-8", value: "你好", byte_order: "big" },
        { id: "tail", kind: "tail", name: "帧尾", value: "0D 0A" },
      ],
    };

    expect(buildHexFrame(config, "").data.toString("hex").toUpperCase()).toBe("AA06E4BDA0E5A5BD0D0A");
    const payload = config.fields[2]!;
    if (payload.kind !== "data") throw new Error("预期为数据字段");
    payload.text_encoding = "gbk";
    expect(buildHexFrame(config, "").data.toString("hex").toUpperCase()).toBe("AA04C4E3BAC30D0A");
  });

  it("定长字符串按编码后的字节数校验", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "fixed-text",
      enabled: true,
      fields: [{
        id: "payload",
        kind: "data",
        name: "定长字符串",
        byte_length: 4,
        source: "fixed",
        data_type: "text",
        text_encoding: "utf-8",
        value: "你好",
        byte_order: "big",
      }],
    };

    expect(() => buildHexFrame(config, "")).toThrow("编码后必须是 4 字节，当前为 6 字节");
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

  it("拒绝校验区间引用尚未计算的后续校验字段", () => {
    const parameters = { preset: "modbus" as const, ...CRC16_PRESETS.modbus };
    const config: HexFrameConfig = {
      version: 1,
      id: "future-crc",
      enabled: true,
      fields: [
        { id: "head", kind: "header", name: "帧头", value: "AA" },
        { id: "crc-1", kind: "checksum", name: "第一段 CRC", method: "crc", byte_length: 2, parameters, script: "", byte_order: "little", range_start_id: "crc-2", range_end_id: "crc-2" },
        { id: "crc-2", kind: "checksum", name: "第二段 CRC", method: "crc", byte_length: 2, parameters, script: "", byte_order: "little", range_start_id: "head", range_end_id: "head" },
      ],
    };
    expect(() => buildHexFrame(config, "")).toThrow("后续校验字段");
  });

  it("允许累加和、异或与自定义 JS 校验在同一帧中组合", () => {
    const parameters = { preset: "modbus" as const, ...CRC16_PRESETS.modbus };
    const config: HexFrameConfig = {
      version: 1,
      id: "multiple-checksums",
      enabled: true,
      fields: [
        { id: "head", kind: "header", name: "输入", value: "01 02 04" },
        { id: "sum", kind: "checksum", name: "SUM16", method: "sum", byte_length: 2, parameters, script: "", byte_order: "little", range_start_id: "head", range_end_id: "head" },
        { id: "xor", kind: "checksum", name: "XOR8", method: "xor", byte_length: 1, parameters, script: "", byte_order: "big", range_start_id: "head", range_end_id: "head" },
        { id: "js", kind: "checksum", name: "JS", method: "custom_js", byte_length: 1, parameters, script: "if (typeof process !== 'undefined' || typeof require !== 'undefined' || typeof SharedArrayBuffer !== 'undefined' || typeof Atomics !== 'undefined') throw new Error('环境未隔离'); return bytes.reduce((sum, byte) => sum + byte, 0) & 0xFF;", byte_order: "big", range_start_id: "head", range_end_id: "head" },
      ],
    };

    expect(buildHexFrame(config, "").data.toString("hex").toUpperCase()).toBe("01020407000707");
  });

  it("自定义 JS 支持 BigInt 和定长 HEX 字符串返回值", () => {
    const parameters = { preset: "modbus" as const, ...CRC16_PRESETS.modbus };
    const base = { version: 1 as const, enabled: true };
    const bigintConfig: HexFrameConfig = {
      ...base,
      id: "custom-bigint",
      fields: [
        { id: "data", kind: "header", name: "输入", value: "01 02 04" },
        { id: "js", kind: "checksum", name: "JS", method: "custom_js", byte_length: 8, parameters, script: "return bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);", byte_order: "big", range_start_id: "data", range_end_id: "data" },
      ],
    };
    const hexConfig: HexFrameConfig = {
      ...base,
      id: "custom-hex",
      fields: [
        { id: "data", kind: "header", name: "输入", value: "01" },
        { id: "js", kind: "checksum", name: "JS", method: "custom_js", byte_length: 2, parameters, script: "return 'AA 55';", byte_order: "little", range_start_id: "data", range_end_id: "data" },
      ],
    };

    expect(buildHexFrame(bigintConfig, "").data.toString("hex").toUpperCase()).toBe("0102040000000000010204");
    expect(buildHexFrame(hexConfig, "").data.toString("hex").toUpperCase()).toBe("01AA55");
  });

  it("限制自定义 JS 执行时间并拒绝无效返回值", () => {
    const parameters = { preset: "modbus" as const, ...CRC16_PRESETS.modbus };
    const field = { id: "js", kind: "checksum" as const, name: "JS", method: "custom_js" as const, byte_length: 1 as const, parameters, script: "while (true) {}", byte_order: "big" as const, range_start_id: "data", range_end_id: "data" };
    const config: HexFrameConfig = {
      version: 1,
      id: "custom-timeout",
      enabled: true,
      fields: [{ id: "data", kind: "header", name: "输入", value: "01" }, field],
    };

    expect(() => buildHexFrame(config, "")).toThrow("执行失败");
    field.script = "return { value: 1 };";
    expect(() => buildHexFrame(config, "")).toThrow("必须返回非负整数");
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

  it("编码自定义生成的 UInt 位掩码和 BCD 数值", () => {
    const generator = {
      control: "bit_checkboxes" as const,
      control_name: "状态位",
      minimum: 0,
      maximum: 65_535,
      step: 1,
      options: "",
    };
    const config: HexFrameConfig = {
      version: 1,
      id: "generated-data",
      enabled: true,
      fields: [
        { id: "bits", kind: "data", name: "状态位", byte_length: 2, source: "generated", data_type: "uint", value: "4660", byte_order: "little", generator },
        { id: "bcd", kind: "data", name: "温度 BCD", byte_length: 2, source: "generated", data_type: "bcd", value: "12.3", byte_order: "big", generator: { ...generator, control: "bcd_slider", step: 0.1 } },
      ],
    };
    expect(buildHexFrame(config, "").data.toString("hex").toUpperCase()).toBe("34120123");
  });

  it("按 IEEE 754 和字段字节顺序编码自定义生成的 Float32/Float64", () => {
    const generator = {
      control: "float32_slider" as const,
      control_name: "浮点值",
      minimum: -100,
      maximum: 100,
      step: 0.1,
      options: "",
    };
    const config: HexFrameConfig = {
      version: 1,
      id: "generated-floats",
      enabled: true,
      fields: [
        { id: "f32-be", kind: "data", name: "Float32 BE", byte_length: 4, source: "generated", data_type: "float32", value: "1.5", byte_order: "big", generator },
        { id: "f32-le", kind: "data", name: "Float32 LE", byte_length: 4, source: "generated", data_type: "float32", value: "1.5", byte_order: "little", generator },
        { id: "f64-be", kind: "data", name: "Float64 BE", byte_length: 8, source: "generated", data_type: "float64", value: "1.5", byte_order: "big", generator: { ...generator, control: "float64_slider" } },
      ],
    };
    expect(buildHexFrame(config, "").data.toString("hex").toUpperCase())
      .toBe("3FC000000000C03F3FF8000000000000");
  });

  it("拒绝 Float 自定义生成值超出范围、不符合步进或不是有限数", () => {
    const field = {
      id: "float-slider",
      kind: "data" as const,
      name: "浮点目标值",
      byte_length: 4 as const,
      source: "generated" as const,
      data_type: "float32" as const,
      value: "1.25",
      byte_order: "big" as const,
      generator: { control: "float32_slider" as const, control_name: "浮点目标值", minimum: -1, maximum: 2, step: 0.1, options: "" },
    };
    const config: HexFrameConfig = { version: 1, id: "float-validation", enabled: true, fields: [field] };
    expect(() => buildHexFrame(config, "")).toThrow("步进精度 0.1");
    field.value = "3";
    expect(() => buildHexFrame(config, "")).toThrow("-1 到 2");
    field.value = "Infinity";
    expect(() => buildHexFrame(config, "")).toThrow("必须是有效数字");
  });

  it("拒绝缺少控件配置的自定义生成字段", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "missing-generator",
      enabled: true,
      fields: [
        { id: "data", kind: "data", name: "生成数据", byte_length: 1, source: "generated", data_type: "uint", value: "1", byte_order: "big" },
      ],
    };
    expect(() => buildHexFrame(config, "")).toThrow("缺少自定义生成配置");
  });

  it("拒绝超出滑块范围或不符合步进精度的生成值", () => {
    const field = {
      id: "slider",
      kind: "data" as const,
      name: "目标值",
      byte_length: 1 as const,
      source: "generated" as const,
      data_type: "uint" as const,
      value: "5",
      byte_order: "big" as const,
      generator: { control: "uint_slider" as const, control_name: "目标值", minimum: 0, maximum: 10, step: 2, options: "" },
    };
    const config: HexFrameConfig = { version: 1, id: "slider-validation", enabled: true, fields: [field] };
    expect(() => buildHexFrame(config, "")).toThrow("步进精度 2");
    field.value = "12";
    expect(() => buildHexFrame(config, "")).toThrow("0 到 10");
  });
});
