import type {
  FrameParseResult,
  FrameParserConfig,
  FrameParserField,
  ParsedFieldValue,
} from "./types";

export const MAX_FRAME_PARSER_FIELDS = 32;
export const MAX_FRAME_PARSER_BYTES = 65_535;

export function parseReceivedFrame(config: FrameParserConfig, hex: string): FrameParseResult {
  const validationError = validateFrameParserConfig(config);
  if (validationError) return { status: "error", message: validationError, values: [] };
  const data = parseHexBytes(hex);
  if (!data) return { status: "error", message: "接收数据不是有效的 HEX 字节流", values: [] };
  if (data.length < config.minimum_length) {
    return { status: "unmatched", message: `帧长 ${data.length} Byte，小于要求的 ${config.minimum_length} Byte`, values: [] };
  }

  const matchBytes = parseHexBytes(config.match_hex);
  if (matchBytes && matchBytes.length > 0) {
    const end = config.match_offset + matchBytes.length;
    if (end > data.length) return { status: "unmatched", message: "固定字节匹配范围超出接收帧", values: [] };
    if (!matchBytes.every((byte, index) => data[config.match_offset + index] === byte)) {
      return { status: "unmatched", message: "固定字节不匹配", values: [] };
    }
  }

  try {
    const values: ParsedFieldValue[] = [];
    const rawLengths = new Map<string, number>();
    let dynamicOffset: number | null = null;
    for (const [index, field] of config.fields.entries()) {
      const offset: number = dynamicOffset ?? field.offset;
      const byteLength = resolveFieldByteLength(config.fields, index, data.length, offset, rawLengths);
      const end: number = offset + byteLength;
      if (end > data.length) {
        return { status: "unmatched", message: `${field.name} 超出接收帧长度`, values: [] };
      }
      if (field.kind === "fixed") {
        const expected = parseHexBytes(field.match_hex)!;
        if (!expected.every((byte, byteIndex) => data[offset + byteIndex] === byte)) {
          return { status: "unmatched", message: `${field.name} 固定字节不匹配`, values: [] };
        }
      } else if (field.kind === "value") {
        const parsed = decodeField(field, data, offset, byteLength);
        values.push(parsed);
        if (field.data_type === "uint") rawLengths.set(field.id, parsedUnsignedLength(field, data.slice(offset, end)));
      }
      if (dynamicOffset !== null || field.length_mode !== "fixed") dynamicOffset = end;
    }
    return {
      status: "matched",
      message: `已解析 ${values.length} 个字段`,
      values,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "帧解析失败",
      values: [],
    };
  }
}

export function reflowFrameParserFields(fields: FrameParserField[]): void {
  let offset = 0;
  for (const field of fields) {
    field.offset = offset;
    if (field.length_mode === "fixed") offset += field.byte_length;
  }
}

export function frameParserMinimumByteLength(fields: FrameParserField[]): number {
  return fields.reduce((total, field) => total + (field.length_mode === "fixed" ? field.byte_length : 0), 0);
}

export function validateFrameParserConfig(config: FrameParserConfig): string | null {
  if (config.version !== 1) return "不支持的解析配置版本";
  if (!config.id || config.id.length > 80) return "解析配置 ID 无效";
  if (!config.name.trim() || config.name.length > 60) return "解析方案名称应为 1 至 60 个字符";
  if (!Number.isInteger(config.minimum_length) || config.minimum_length < 0 || config.minimum_length > MAX_FRAME_PARSER_BYTES) {
    return `最小帧长应为 0 至 ${MAX_FRAME_PARSER_BYTES} Byte`;
  }
  if (!Number.isInteger(config.match_offset) || config.match_offset < 0 || config.match_offset > MAX_FRAME_PARSER_BYTES) {
    return "固定字节匹配偏移无效";
  }
  const normalizedMatch = compactHex(config.match_hex);
  if (normalizedMatch.length % 2 !== 0 || !/^[0-9A-F]*$/i.test(normalizedMatch)) return "固定匹配内容应为完整 HEX 字节";
  if (config.match_offset + normalizedMatch.length / 2 > MAX_FRAME_PARSER_BYTES) return "固定字节匹配范围过大";
  if (config.fields.length > MAX_FRAME_PARSER_FIELDS) return `解析字段最多 ${MAX_FRAME_PARSER_FIELDS} 个`;
  const ids = new Set<string>();
  for (const field of config.fields) {
    const error = validateField(field);
    if (error) return error;
    if (ids.has(field.id)) return `字段 ID 重复：${field.name}`;
    ids.add(field.id);
  }
  for (const [index, field] of config.fields.entries()) {
    if (field.length_mode === "remaining" && config.fields.slice(index + 1).some((candidate) => candidate.length_mode !== "fixed")) {
      return `${field.name} 后不能再放置另一个变长字段`;
    }
    if (field.length_mode !== "field") continue;
    const sourceIndex = config.fields.findIndex((candidate) => candidate.id === field.length_field_id);
    const source = config.fields[sourceIndex];
    if (sourceIndex < 0 || sourceIndex >= index || source?.kind !== "value" || source.data_type !== "uint" || source.length_mode !== "fixed") {
      return `${field.name} 的长度来源必须是它前面的定长 UInt 字段`;
    }
  }
  return null;
}

function validateField(field: FrameParserField): string | null {
  const label = field.name.trim() || "未命名字段";
  if (!field.id || field.id.length > 80) return `${label} 的字段 ID 无效`;
  if (!field.name.trim() || field.name.length > 60) return "字段名称应为 1 至 60 个字符";
  if (field.kind !== "fixed" && field.kind !== "value" && field.kind !== "skip") return `${label} 的字段类型无效`;
  if (!Number.isInteger(field.offset) || field.offset < 0 || field.offset > MAX_FRAME_PARSER_BYTES) return `${label} 的起始偏移无效`;
  if (!Number.isInteger(field.byte_length) || field.byte_length < 1 || field.byte_length > MAX_FRAME_PARSER_BYTES) return `${label} 的字节长度应为 1 至 ${MAX_FRAME_PARSER_BYTES}`;
  if (field.length_mode !== "fixed" && field.length_mode !== "remaining" && field.length_mode !== "field") return `${label} 的长度方式无效`;
  if (field.kind !== "value" && field.length_mode !== "fixed") return `${label} 只能使用定长方式`;
  if (field.length_mode !== "fixed" && field.data_type !== "hex" && field.data_type !== "text" && field.data_type !== "ascii") {
    return `${label} 的变长数据只能解析为 HEX 或字符串`;
  }
  if (field.length_mode === "field" && !field.length_field_id) return `${label} 必须选择长度来源字段`;
  if (field.text_encoding !== "utf-8" && field.text_encoding !== "ascii" && field.text_encoding !== "gbk") return `${label} 的字符串编码无效`;
  if (field.length_mode === "fixed" && field.offset + field.byte_length > MAX_FRAME_PARSER_BYTES) return `${label} 的切片范围过大`;
  const normalizedMatch = compactHex(field.match_hex);
  if (field.kind === "fixed") {
    if (normalizedMatch.length === 0 || normalizedMatch.length % 2 !== 0 || !/^[0-9A-F]+$/i.test(normalizedMatch)) {
      return `${label} 的固定内容应为完整 HEX 字节`;
    }
    if (normalizedMatch.length / 2 !== field.byte_length) return `${label} 的固定内容与字节长度不一致`;
  }
  if (field.kind !== "value") return null;
  if ((field.data_type === "float32" && field.byte_length !== 4) || (field.data_type === "float64" && field.byte_length !== 8)) {
    return `${label} 的浮点类型与字节长度不匹配`;
  }
  if ((field.data_type === "uint" || field.data_type === "int" || field.data_type === "boolean") && field.byte_length > 8) {
    return `${label} 的整数或布尔字段不能超过 8 Byte`;
  }
  if (field.data_type === "bcd" && field.byte_length > 8) return `${label} 的 BCD 字段不能超过 8 Byte`;
  if (!Number.isInteger(field.bit_index) || field.bit_index < 0 || field.bit_index >= field.byte_length * 8) return `${label} 的位序号超出字段范围`;
  if (!Number.isFinite(field.scale) || !Number.isFinite(field.value_offset)) return `${label} 的倍率或偏移无效`;
  if (!Number.isInteger(field.decimals) || field.decimals < 0 || field.decimals > 8) return `${label} 的小数位应为 0 至 8`;
  if (field.unit.length > 20) return `${label} 的单位不能超过 20 个字符`;
  if (!Number.isFinite(field.minimum) || !Number.isFinite(field.maximum) || field.minimum >= field.maximum) return `${label} 的仪表范围无效`;
  if (!/^#[0-9A-F]{6}$/i.test(field.color)) return `${label} 的显示颜色无效`;
  return null;
}

function decodeField(field: FrameParserField, frame: Uint8Array, offset: number, byteLength: number): ParsedFieldValue {
  const end = offset + byteLength;
  if (end > frame.length) throw new Error(`${field.name} 需要 Byte ${offset} 至 ${end - 1}，当前帧仅 ${frame.length} Byte`);
  const bytes = frame.slice(offset, end);
  const raw = formatBytes(bytes);
  if (field.data_type === "hex") return textResult(field, offset, byteLength, raw, raw);
  if (field.data_type === "text" || field.data_type === "ascii") {
    const encoding = field.data_type === "ascii" ? "ascii" : field.text_encoding;
    const value = decodeText(bytes, encoding, field.name).replaceAll("\0", "");
    return textResult(field, offset, byteLength, raw, value);
  }

  let decoded: number;
  if (field.data_type === "float32" || field.data_type === "float64") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    decoded = field.data_type === "float32"
      ? view.getFloat32(0, field.byte_order === "little")
      : view.getFloat64(0, field.byte_order === "little");
  } else if (field.data_type === "bcd") {
    const ordered = field.byte_order === "little" ? Uint8Array.from(bytes).reverse() : bytes;
    const digits = [...ordered].map((byte) => {
      const high = byte >> 4;
      const low = byte & 0x0f;
      if (high > 9 || low > 9) throw new Error(`${field.name} 包含无效 BCD 字节 ${byte.toString(16).padStart(2, "0").toUpperCase()}`);
      return `${high}${low}`;
    }).join("");
    decoded = Number(digits);
  } else {
    const unsigned = decodeUnsigned(bytes, field.byte_order);
    if (field.data_type === "boolean") decoded = Number((unsigned >> BigInt(field.bit_index)) & 1n);
    else if (field.data_type === "int") {
      const bits = BigInt(byteLength * 8);
      const sign = 1n << (bits - 1n);
      const signed = (unsigned & sign) === 0n ? unsigned : unsigned - (1n << bits);
      if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new Error(`${field.name} 超出 JavaScript 安全整数范围，请缩短字段或改用 HEX 显示`);
      }
      decoded = Number(signed);
    } else {
      if (unsigned > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${field.name} 超出 JavaScript 安全整数范围，请缩短字段或改用 HEX 显示`);
      }
      decoded = Number(unsigned);
    }
  }
  if (!Number.isFinite(decoded)) throw new Error(`${field.name} 的解析结果不是有限数值`);
  const numeric = decoded * field.scale + field.value_offset;
  if (!Number.isFinite(numeric)) throw new Error(`${field.name} 的换算结果超出数值范围`);
  const value = field.data_type === "boolean" ? numeric !== 0 : numeric;
  return {
    field_id: field.id,
    offset,
    byte_length: byteLength,
    raw,
    value,
    numeric,
    formatted: field.data_type === "boolean"
      ? (value ? "开启" : "关闭")
      : numeric.toFixed(field.decimals),
  };
}

function textResult(field: FrameParserField, offset: number, byteLength: number, raw: string, value: string): ParsedFieldValue {
  return { field_id: field.id, offset, byte_length: byteLength, raw, value, numeric: null, formatted: value };
}

function resolveFieldByteLength(
  fields: FrameParserField[],
  index: number,
  frameLength: number,
  offset: number,
  rawLengths: Map<string, number>,
): number {
  const field = fields[index]!;
  if (field.length_mode === "fixed") return field.byte_length;
  if (field.length_mode === "field") {
    const byteLength = rawLengths.get(field.length_field_id ?? "");
    if (byteLength === undefined) throw new Error(`${field.name} 的长度字段尚未解析`);
    if (byteLength > MAX_FRAME_PARSER_BYTES) throw new Error(`${field.name} 的动态长度超过 ${MAX_FRAME_PARSER_BYTES} Byte`);
    return byteLength;
  }
  const trailingLength = fields.slice(index + 1).reduce((total, candidate) => total + candidate.byte_length, 0);
  const byteLength = frameLength - offset - trailingLength;
  if (byteLength < 0) throw new Error(`${field.name} 没有足够字节可供解析`);
  return byteLength;
}

function parsedUnsignedLength(field: FrameParserField, bytes: Uint8Array): number {
  const value = decodeUnsigned(bytes, field.byte_order);
  if (value > BigInt(MAX_FRAME_PARSER_BYTES)) return MAX_FRAME_PARSER_BYTES + 1;
  return Number(value);
}

function decodeText(bytes: Uint8Array, encoding: "utf-8" | "ascii" | "gbk", label: string): string {
  if (encoding === "ascii" && bytes.some((byte) => byte > 0x7f)) throw new Error(`${label} 包含非 ASCII 字节`);
  try {
    return new TextDecoder(encoding === "ascii" ? "utf-8" : encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} 不是有效的 ${encoding.toUpperCase()} 字符串`);
  }
}

function decodeUnsigned(bytes: Uint8Array, order: "big" | "little"): bigint {
  const ordered = order === "little" ? Uint8Array.from(bytes).reverse() : bytes;
  let value = 0n;
  for (const byte of ordered) value = (value << 8n) | BigInt(byte);
  return value;
}

function parseHexBytes(value: string): Uint8Array | null {
  const normalized = compactHex(value);
  if (normalized.length % 2 !== 0 || !/^[0-9A-F]*$/i.test(normalized)) return null;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function compactHex(value: string): string {
  return value.replaceAll(/\s/g, "");
}

function formatBytes(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}
