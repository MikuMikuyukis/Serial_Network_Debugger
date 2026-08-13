import { parseHex } from "./codec.js";
import type {
  ByteOrder,
  Crc16Parameters,
  HexFrameConfig,
  HexFrameField,
} from "./types.js";

const MAX_ASSEMBLED_FRAME_BYTES = 4 * 1_048_576;

export interface HexFrameBuildResult {
  data: Buffer;
  nextSequences: Record<string, string>;
}

export class HexFrameSession {
  readonly #sequences = new Map<string, Record<string, string>>();
  #operation = Promise.resolve();

  preview(config: HexFrameConfig, editorData: string): HexFrameBuildResult {
    return buildHexFrame(config, editorData, this.#sequences.get(config.id));
  }

  send(
    config: HexFrameConfig,
    editorData: string,
    target: (data: Buffer) => Promise<void>,
  ): Promise<HexFrameBuildResult> {
    return this.#exclusive(async () => {
      const result = this.preview(config, editorData);
      if (result.data.length === 0) throw new Error("组装后的 HEX 帧不能为空");
      await target(result.data);
      this.#sequences.set(config.id, result.nextSequences);
      return result;
    });
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operation;
    let release: () => void = () => undefined;
    this.#operation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export const CRC16_PRESETS: Record<Exclude<Crc16Parameters["preset"], "custom">, Omit<Crc16Parameters, "preset">> = {
  modbus: { polynomial: "8005", initial: "FFFF", xor_out: "0000", reflect_input: true, reflect_output: true },
  arc: { polynomial: "8005", initial: "0000", xor_out: "0000", reflect_input: true, reflect_output: true },
  ccitt_false: { polynomial: "1021", initial: "FFFF", xor_out: "0000", reflect_input: false, reflect_output: false },
  xmodem: { polynomial: "1021", initial: "0000", xor_out: "0000", reflect_input: false, reflect_output: false },
  x25: { polynomial: "1021", initial: "FFFF", xor_out: "FFFF", reflect_input: true, reflect_output: true },
  kermit: { polynomial: "1021", initial: "0000", xor_out: "0000", reflect_input: true, reflect_output: true },
};

export function buildHexFrame(
  config: HexFrameConfig,
  editorData: string,
  sequenceValues: Record<string, string> = {},
): HexFrameBuildResult {
  if (!config.enabled) throw new Error("HEX 帧配置未启用");
  if (config.fields.length === 0) throw new Error("HEX 帧至少需要一个字段");
  ensureUniqueFieldIds(config.fields);

  const parts = config.fields.map((field) => initialFieldBytes(field, editorData, sequenceValues));

  config.fields.forEach((field, index) => {
    if (field.kind !== "length") return;
    const range = resolveRange(config.fields, field.range_start_id, field.range_end_id, 0, parts.length - 1);
    const length = rangeByteLength(parts, range.start, range.end);
    parts[index] = encodeUnsigned(BigInt(length), field.byte_length, field.byte_order, `帧长度 ${field.name}`);
  });

  config.fields.forEach((field, index) => {
    if (field.kind !== "checksum") return;
    const defaultEnd = Math.max(index - 1, 0);
    const range = resolveRange(config.fields, field.range_start_id, field.range_end_id, 0, defaultEnd);
    if (range.start <= index && index <= range.end) {
      throw new Error(`${field.name || "CRC16"} 的校验区间不能包含自身`);
    }
    const unresolvedChecksum = config.fields.findIndex((candidate, candidateIndex) => (
      candidateIndex >= index
      && candidateIndex >= range.start
      && candidateIndex <= range.end
      && candidate.kind === "checksum"
    ));
    if (unresolvedChecksum >= 0) {
      throw new Error(`${field.name || "CRC16"} 的校验区间不能包含自身或后续 CRC16 字段`);
    }
    const input = Buffer.concat(parts.slice(range.start, range.end + 1));
    const checksum = crc16(input, field.parameters);
    parts[index] = encodeUnsigned(BigInt(checksum), 2, field.byte_order, `校验 ${field.name}`);
  });

  const data = Buffer.concat(parts);
  if (data.length > MAX_ASSEMBLED_FRAME_BYTES) {
    throw new Error(`组装后的 HEX 帧不能超过 ${MAX_ASSEMBLED_FRAME_BYTES} 字节`);
  }

  const nextSequences: Record<string, string> = {};
  config.fields.forEach((field) => {
    if (field.kind !== "sequence") return;
    const current = parseUnsignedHex(sequenceValues[field.id] ?? field.value, `帧序号 ${field.name}`);
    const modulus = 1n << BigInt(field.byte_length * 8);
    const next = (current + BigInt(field.step)) % modulus;
    nextSequences[field.id] = formatUnsignedHex(next, field.byte_length);
  });
  return { data, nextSequences };
}

export function crc16(data: Uint8Array, parameters: Crc16Parameters): number {
  const polynomial = parseCrcWord(parameters.polynomial, "CRC16 多项式");
  let crc = parseCrcWord(parameters.initial, "CRC16 初始值");
  const xorOut = parseCrcWord(parameters.xor_out, "CRC16 结果异或值");

  if (parameters.reflect_input) {
    const reflectedPolynomial = reflect16(polynomial);
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) !== 0 ? (crc >>> 1) ^ reflectedPolynomial : crc >>> 1;
      }
    }
  } else {
    for (const byte of data) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ polynomial) & 0xffff : (crc << 1) & 0xffff;
      }
    }
  }
  if (parameters.reflect_output !== parameters.reflect_input) crc = reflect16(crc);
  return (crc ^ xorOut) & 0xffff;
}

function initialFieldBytes(
  field: HexFrameField,
  editorData: string,
  sequenceValues: Record<string, string>,
): Buffer {
  switch (field.kind) {
    case "header":
    case "frame_id":
    case "tail":
      return parseFieldHex(field.value, field.name);
    case "sequence": {
      const value = parseUnsignedHex(sequenceValues[field.id] ?? field.value, `帧序号 ${field.name}`);
      return encodeUnsigned(value, field.byte_length, field.byte_order, `帧序号 ${field.name}`);
    }
    case "length":
      return Buffer.alloc(field.byte_length);
    case "checksum":
      return Buffer.alloc(2);
    case "data": {
      const value = field.source === "editor" ? editorData : field.value;
      return encodeDataField(field, value);
    }
  }
}

function encodeDataField(
  field: Extract<HexFrameField, { kind: "data" }>,
  value: string,
): Buffer {
  if (field.source === "editor" && field.data_type !== "hex") {
    throw new Error(`${field.name || "数据字段"} 使用发送框数据时必须选择 HEX 字节类型`);
  }
  if (field.data_type === "hex") {
    let data = parseFieldHex(value, field.name);
    if (field.byte_length !== null && data.length !== field.byte_length) {
      throw new Error(`${field.name || "数据字段"} 必须是 ${field.byte_length} 字节`);
    }
    if (field.byte_order === "little" && data.length > 1) data = Buffer.from(data).reverse();
    return data;
  }
  if (field.data_type === "float32" || field.data_type === "float64") {
    const byteLength = field.data_type === "float32" ? 4 : 8;
    if (field.byte_length !== byteLength) {
      throw new Error(`${field.name || "浮点字段"} 必须是 ${byteLength} 字节`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`${field.name || "浮点字段"} 必须是有效数字`);
    const data = Buffer.alloc(byteLength);
    if (field.data_type === "float32") {
      field.byte_order === "little" ? data.writeFloatLE(numeric) : data.writeFloatBE(numeric);
    } else {
      field.byte_order === "little" ? data.writeDoubleLE(numeric) : data.writeDoubleBE(numeric);
    }
    return data;
  }
  if (field.byte_length === null) throw new Error(`${field.name || "整数字段"} 必须选择字节长度`);
  let integer: bigint;
  try {
    integer = BigInt(value.trim());
  } catch {
    throw new Error(`${field.name || "整数字段"} 必须是十进制整数`);
  }
  const bits = BigInt(field.byte_length * 8);
  if (field.data_type === "uint") {
    return encodeUnsigned(integer, field.byte_length, field.byte_order, field.name || "无符号整数");
  }
  const minimum = -(1n << (bits - 1n));
  const maximum = (1n << (bits - 1n)) - 1n;
  if (integer < minimum || integer > maximum) {
    throw new Error(`${field.name || "有符号整数"} 超出 ${field.byte_length} 字节范围`);
  }
  if (integer < 0n) integer += 1n << bits;
  return encodeUnsigned(integer, field.byte_length, field.byte_order, field.name || "有符号整数");
}

function resolveRange(
  fields: HexFrameField[],
  startId: string | null,
  endId: string | null,
  defaultStart: number,
  defaultEnd: number,
): { start: number; end: number } {
  const start = startId === null ? defaultStart : fields.findIndex((field) => field.id === startId);
  const end = endId === null ? defaultEnd : fields.findIndex((field) => field.id === endId);
  if (start < 0) throw new Error("字段统计区间的起始字段不存在");
  if (end < 0) throw new Error("字段统计区间的结束字段不存在");
  if (start > end) throw new Error("字段统计区间的起始位置不能晚于结束位置");
  return { start, end };
}

function rangeByteLength(parts: Buffer[], start: number, end: number): number {
  let length = 0;
  for (let index = start; index <= end; index += 1) length += parts[index]!.length;
  return length;
}

function parseFieldHex(value: string, name: string): Buffer {
  try {
    return parseHex(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name || "字段"}：${message}`);
  }
}

function parseUnsignedHex(value: string, label: string): bigint {
  const cleaned = value.trim().replace(/^0[xX]/, "").replaceAll(/[\s_:,-]+/g, "");
  if (!cleaned || !/^[0-9a-fA-F]+$/.test(cleaned)) throw new Error(`${label} 必须是十六进制整数`);
  return BigInt(`0x${cleaned}`);
}

function encodeUnsigned(value: bigint, byteLength: number, byteOrder: ByteOrder, label: string): Buffer {
  const maximum = (1n << BigInt(byteLength * 8)) - 1n;
  if (value < 0n || value > maximum) throw new Error(`${label} 超出 ${byteLength} 字节范围`);
  const bytes = Buffer.from(formatUnsignedHex(value, byteLength), "hex");
  return byteOrder === "little" ? bytes.reverse() : bytes;
}

function formatUnsignedHex(value: bigint, byteLength: number): string {
  return value.toString(16).toUpperCase().padStart(byteLength * 2, "0");
}

function parseCrcWord(value: string, label: string): number {
  const parsed = parseUnsignedHex(value, label);
  if (parsed > 0xffffn) throw new Error(`${label} 超出 16 位范围`);
  return Number(parsed);
}

function reflect16(value: number): number {
  let reflected = 0;
  for (let bit = 0; bit < 16; bit += 1) {
    reflected = (reflected << 1) | ((value >>> bit) & 1);
  }
  return reflected & 0xffff;
}

function ensureUniqueFieldIds(fields: HexFrameField[]): void {
  const ids = new Set<string>();
  for (const field of fields) {
    if (ids.has(field.id)) throw new Error(`帧字段 ID 重复：${field.id}`);
    ids.add(field.id);
  }
}
