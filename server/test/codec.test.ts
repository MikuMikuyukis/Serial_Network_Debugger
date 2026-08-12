import { describe, expect, it } from "vitest";
import { encodePayload, formatData, parseHex } from "../src/core/codec.js";

describe("codec", () => {
  it.each([
    ["AA 55 01", [0xaa, 0x55, 0x01]],
    ["0xAA,0x55;01", [0xaa, 0x55, 0x01]],
    ["aa55_01", [0xaa, 0x55, 0x01]],
    ["", []],
  ])("解析常见 HEX 写法 %s", (value, expected) => {
    expect([...parseHex(value)]).toEqual(expected);
  });

  it.each(["ABC", "GG", "01.ZZ"])("拒绝无效 HEX：%s", (value) => {
    expect(() => parseHex(value)).toThrow();
  });

  it("编码文本和行尾", () => {
    expect(encodePayload("你好", "text", "utf-8", "crlf"))
      .toEqual(Buffer.from("你好\r\n"));
  });

  it("编码 GBK 并拒绝 ASCII 范围外字符", () => {
    expect(encodePayload("你好", "text", "gbk").toString("hex")).toBe("c4e3bac3");
    expect(() => encodePayload("你好", "text", "ascii")).toThrow("ascii");
  });

  it("格式化 HEX 和容错 UTF-8 文本", () => {
    expect(formatData(Buffer.from([0x41, 0xff]))).toEqual({ hex: "41 FF", text: "A�" });
  });
});
