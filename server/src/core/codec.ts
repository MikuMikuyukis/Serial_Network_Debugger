import iconv from "iconv-lite";
import type { DataFormat, LineEnding, TextEncoding } from "./types.js";

const lineEndings: Record<LineEnding, Buffer> = {
  none: Buffer.alloc(0),
  cr: Buffer.from("\r"),
  lf: Buffer.from("\n"),
  crlf: Buffer.from("\r\n"),
};

export function parseHex(value: string): Buffer {
  const cleaned = value
    .replaceAll(/0[xX]/g, "")
    .replaceAll(/[\s,;:_-]+/g, "");
  if (!cleaned) return Buffer.alloc(0);
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    throw new Error("HEX 数据包含非十六进制字符");
  }
  if (cleaned.length % 2 !== 0) {
    throw new Error("HEX 数据必须由完整字节组成（每字节两位）");
  }
  return Buffer.from(cleaned, "hex");
}

export function encodePayload(
  value: string,
  format: DataFormat,
  textEncoding: TextEncoding = "utf-8",
  lineEnding: LineEnding = "none",
): Buffer {
  let payload: Buffer;
  if (format === "hex") {
    payload = parseHex(value);
  } else if (textEncoding === "ascii") {
    if ([...value].some((character) => character.codePointAt(0)! > 0x7f)) {
      throw new Error("文本无法使用 ascii 编码");
    }
    payload = Buffer.from(value, "ascii");
  } else if (textEncoding === "gbk") {
    payload = iconv.encode(value, "gbk");
    if (iconv.decode(payload, "gbk") !== value) {
      throw new Error("文本无法使用 gbk 编码");
    }
  } else {
    payload = Buffer.from(value, "utf8");
  }
  return Buffer.concat([payload, lineEndings[lineEnding]]);
}

export function formatData(data: Buffer): { hex: string; text: string } {
  return {
    hex: data.toString("hex").toUpperCase().replaceAll(/(..)(?=.)/g, "$1 "),
    text: data.toString("utf8"),
  };
}
