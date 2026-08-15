import { describe, expect, it } from "vitest";
import { parseReceivedFrame, reflowFrameParserFields, validateFrameParserConfig } from "../../frontend/src/frame-parser.js";
import type { FrameParserConfig, FrameParserField } from "../../frontend/src/types.js";

describe("RX frame parser", () => {
  it("按偏移和字节序解析整数、浮点、BCD、状态位、HEX 与 ASCII", () => {
    const config = parserConfig([
      field("uint", 2, 2, "uint", { byte_order: "big", scale: 0.1, value_offset: -10, decimals: 1 }),
      field("int", 4, 2, "int", { byte_order: "little" }),
      field("float", 6, 4, "float32", { byte_order: "big", decimals: 2 }),
      field("bcd", 10, 2, "bcd"),
      field("flag", 12, 1, "boolean", { bit_index: 3, display: "status" }),
      field("hex", 13, 2, "hex"),
      field("ascii", 15, 3, "ascii"),
    ]);
    const result = parseReceivedFrame(config, "AA 55 01 2C FE FF 3F C0 00 00 12 34 08 DE AD 4F 4B 00");

    expect(result.status).toBe("matched");
    expect(result.values.map((value) => value.formatted)).toEqual([
      "20.0",
      "-2",
      "1.50",
      "1234",
      "开启",
      "DE AD",
      "OK",
    ]);
    expect(result.values[0]?.raw).toBe("01 2C");
  });

  it("按固定字节和最小帧长筛选接收帧", () => {
    const config = { ...parserConfig([field("value", 2, 1, "uint")]), minimum_length: 3, match_offset: 0, match_hex: "AA 55" };

    expect(parseReceivedFrame(config, "AA 55 01").status).toBe("matched");
    expect(parseReceivedFrame(config, "AA 54 01")).toMatchObject({ status: "unmatched", message: "固定字节不匹配" });
    expect(parseReceivedFrame(config, "AA 55").status).toBe("unmatched");
  });

  it("按有序固定字段筛选帧并跳过保留字节", () => {
    const fixed = field("header", 0, 2, "hex", { kind: "fixed", match_hex: "AA 55", visible: false });
    const skipped = field("reserved", 2, 1, "hex", { kind: "skip", visible: false });
    const value = field("value", 3, 1, "uint");
    const config = parserConfig([fixed, skipped, value]);

    expect(parseReceivedFrame(config, "AA 55 FF 2A")).toMatchObject({
      status: "matched",
      values: [{ field_id: "value", formatted: "42" }],
    });
    expect(parseReceivedFrame(config, "AA 54 FF 2A")).toMatchObject({
      status: "unmatched",
      message: "header 固定字节不匹配",
    });
    expect(parseReceivedFrame(config, "AA 55")).toMatchObject({
      status: "unmatched",
      message: "reserved 超出接收帧长度",
    });
  });

  it("按长度字段解析 UTF-8 变长字符串并继续匹配帧尾", () => {
    const header = field("header", 0, 2, "hex", { kind: "fixed", match_hex: "AA 55", visible: false });
    const length = field("length", 2, 1, "uint");
    const payload = field("payload", 3, 1, "text", {
      length_mode: "field",
      length_field_id: length.id,
      text_encoding: "utf-8",
    });
    const tail = field("tail", 3, 2, "hex", { kind: "fixed", match_hex: "0D 0A", visible: false });
    const config = parserConfig([header, length, payload, tail]);

    expect(parseReceivedFrame(config, "AA 55 06 E4 BD A0 E5 A5 BD 0D 0A")).toMatchObject({
      status: "matched",
      values: [
        { field_id: "length", formatted: "6", offset: 2, byte_length: 1 },
        { field_id: "payload", formatted: "你好", offset: 3, byte_length: 6 },
      ],
    });
    payload.text_encoding = "gbk";
    expect(parseReceivedFrame(config, "AA 55 04 C4 E3 BA C3 0D 0A")).toMatchObject({
      status: "matched",
      values: [
        { field_id: "length", formatted: "4" },
        { field_id: "payload", formatted: "你好", byte_length: 4 },
      ],
    });
  });

  it("把帧尾前的剩余字节解析为变长字符串", () => {
    const payload = field("payload", 1, 1, "text", { length_mode: "remaining", text_encoding: "ascii" });
    const tail = field("tail", 1, 2, "hex", { kind: "fixed", match_hex: "0D 0A", visible: false });
    const config = parserConfig([field("head", 0, 1, "hex", { kind: "fixed", match_hex: "AA" }), payload, tail]);

    expect(parseReceivedFrame(config, "AA 54 45 53 54 0D 0A")).toMatchObject({
      status: "matched",
      values: [{ field_id: "payload", formatted: "TEST", byte_length: 4 }],
    });
  });

  it("按字段顺序自动重排字节范围", () => {
    const fields = [
      field("header", 9, 2, "hex", { kind: "fixed", match_hex: "AA 55" }),
      field("reserved", 9, 3, "hex", { kind: "skip" }),
      field("value", 9, 2, "uint"),
    ];

    reflowFrameParserFields(fields);

    expect(fields.map((item) => item.offset)).toEqual([0, 2, 5]);
  });

  it("字段切片超出当前帧时视为结构不匹配", () => {
    const result = parseReceivedFrame(parserConfig([field("value", 2, 4, "uint")]), "AA 55 01");

    expect(result.status).toBe("unmatched");
    expect(result.message).toContain("超出接收帧长度");
  });

  it("拒绝把超出安全整数范围的 64 位值静默转换为近似数", () => {
    const result = parseReceivedFrame(parserConfig([field("large", 0, 8, "uint")]), "FF FF FF FF FF FF FF FF");

    expect(result.status).toBe("error");
    expect(result.message).toContain("安全整数范围");
  });

  it("拒绝无效 HEX、BCD 和浮点字段长度", () => {
    expect(parseReceivedFrame(parserConfig([]), "ABC")).toMatchObject({ status: "error", message: "接收数据不是有效的 HEX 字节流" });
    expect(parseReceivedFrame(parserConfig([field("bcd", 0, 1, "bcd")]), "FA").message).toContain("无效 BCD 字节");
    expect(validateFrameParserConfig(parserConfig([field("float", 0, 2, "float32")]))).toContain("浮点类型与字节长度不匹配");
  });

  it("拒绝重复字段 ID 和无效仪表范围", () => {
    const duplicate = field("same", 0, 1, "uint");
    expect(validateFrameParserConfig(parserConfig([duplicate, { ...duplicate }]))).toContain("字段 ID 重复");
    expect(validateFrameParserConfig(parserConfig([field("range", 0, 1, "uint", { minimum: 10, maximum: 10 })]))).toContain("仪表范围无效");
  });
});

function parserConfig(fields: FrameParserField[]): FrameParserConfig {
  return {
    version: 1,
    id: "parser-test",
    name: "测试解析",
    enabled: true,
    minimum_length: 0,
    match_offset: 0,
    match_hex: "",
    fields,
  };
}

function field(
  id: string,
  offset: number,
  byteLength: number,
  dataType: FrameParserField["data_type"],
  changes: Partial<FrameParserField> = {},
): FrameParserField {
  return {
    id,
    name: id,
    kind: "value",
    offset,
    byte_length: byteLength,
    length_mode: "fixed",
    length_field_id: null,
    match_hex: "",
    data_type: dataType,
    text_encoding: "utf-8",
    byte_order: "big",
    bit_index: 0,
    scale: 1,
    value_offset: 0,
    decimals: 0,
    unit: "",
    visible: true,
    display: "number",
    minimum: 0,
    maximum: 100,
    color: "#13A88E",
    ...changes,
  };
}
