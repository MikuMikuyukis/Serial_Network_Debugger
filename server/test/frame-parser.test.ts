import { describe, expect, it } from "vitest";
import { parseReceivedFrame, validateFrameParserConfig } from "../../frontend/src/frame-parser.js";
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

  it("字段切片超出当前帧时返回解析错误", () => {
    const result = parseReceivedFrame(parserConfig([field("value", 2, 4, "uint")]), "AA 55 01");

    expect(result.status).toBe("error");
    expect(result.message).toContain("当前帧仅 3 Byte");
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
    offset,
    byte_length: byteLength,
    data_type: dataType,
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
