import { encodePayload, parseHex } from "./codec.js";
import { executeCustomChecksumScript } from "./custom-checksum-sandbox.js";
import type {
  ByteOrder,
  CrcParameters,
  HexFrameChecksumField,
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

export const CRC_PRESETS: Record<Exclude<CrcParameters["preset"], "custom">, Omit<CrcParameters, "preset">> = {
  crc8: { width: 8, polynomial: "07", initial: "00", xor_out: "00", reflect_input: false, reflect_output: false },
  crc8_maxim: { width: 8, polynomial: "31", initial: "00", xor_out: "00", reflect_input: true, reflect_output: true },
  modbus: { width: 16, polynomial: "8005", initial: "FFFF", xor_out: "0000", reflect_input: true, reflect_output: true },
  arc: { width: 16, polynomial: "8005", initial: "0000", xor_out: "0000", reflect_input: true, reflect_output: true },
  ccitt_false: { width: 16, polynomial: "1021", initial: "FFFF", xor_out: "0000", reflect_input: false, reflect_output: false },
  xmodem: { width: 16, polynomial: "1021", initial: "0000", xor_out: "0000", reflect_input: false, reflect_output: false },
  x25: { width: 16, polynomial: "1021", initial: "FFFF", xor_out: "FFFF", reflect_input: true, reflect_output: true },
  kermit: { width: 16, polynomial: "1021", initial: "0000", xor_out: "0000", reflect_input: true, reflect_output: true },
  crc32: { width: 32, polynomial: "04C11DB7", initial: "FFFFFFFF", xor_out: "FFFFFFFF", reflect_input: true, reflect_output: true },
  crc32_mpeg2: { width: 32, polynomial: "04C11DB7", initial: "FFFFFFFF", xor_out: "00000000", reflect_input: false, reflect_output: false },
};

export const CRC16_PRESETS = {
  modbus: CRC_PRESETS.modbus,
  arc: CRC_PRESETS.arc,
  ccitt_false: CRC_PRESETS.ccitt_false,
  xmodem: CRC_PRESETS.xmodem,
  x25: CRC_PRESETS.x25,
  kermit: CRC_PRESETS.kermit,
} as const;

export function containsCustomChecksum(config: HexFrameConfig | undefined): boolean {
  return Boolean(config?.fields.some((field) => field.kind === "checksum" && field.method === "custom_js"));
}

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
      throw new Error(`${field.name || "校验字段"} 的校验区间不能包含自身`);
    }
    const unresolvedChecksum = config.fields.findIndex((candidate, candidateIndex) => (
      candidateIndex >= index
      && candidateIndex >= range.start
      && candidateIndex <= range.end
      && candidate.kind === "checksum"
    ));
    if (unresolvedChecksum >= 0) {
      throw new Error(`${field.name || "校验字段"} 的校验区间不能包含自身或后续校验字段`);
    }
    const input = Buffer.concat(parts.slice(range.start, range.end + 1));
    parts[index] = buildChecksum(field, input);
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

export function crc(data: Uint8Array, parameters: CrcParameters): number {
  const width = parameters.width;
  const polynomial = parseCrcValue(parameters.polynomial, width, "CRC 多项式");
  let value = parseCrcValue(parameters.initial, width, "CRC 初始值");
  const xorOut = parseCrcValue(parameters.xor_out, width, "CRC 结果异或值");
  const mask = width === 32 ? 0xffff_ffff : (1 << width) - 1;

  if (parameters.reflect_input) {
    const reflectedPolynomial = reflectBits(polynomial, width);
    for (const byte of data) {
      value = (value ^ byte) >>> 0;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? ((value >>> 1) ^ reflectedPolynomial) >>> 0 : value >>> 1;
      }
      if (width < 32) value &= mask;
    }
  } else {
    const topBit = width === 32 ? 0x8000_0000 : 1 << (width - 1);
    for (const byte of data) {
      value = (value ^ (byte << (width - 8))) >>> 0;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & topBit) !== 0 ? ((value << 1) ^ polynomial) >>> 0 : (value << 1) >>> 0;
        if (width < 32) value &= mask;
      }
    }
  }
  if (parameters.reflect_output !== parameters.reflect_input) value = reflectBits(value, width);
  value = (value ^ xorOut) >>> 0;
  return width === 32 ? value : (value & mask) >>> 0;
}

export function crc16(data: Uint8Array, parameters: CrcParameters): number {
  if (parameters.width !== 16) throw new Error("crc16() 只接受 16 位 CRC 参数");
  return crc(data, parameters);
}

function buildChecksum(field: HexFrameChecksumField, input: Buffer): Buffer {
  const label = `校验 ${field.name || "字段"}`;
  if (field.method === "crc") {
    const expectedLength = field.parameters.width / 8;
    if (field.byte_length !== expectedLength) throw new Error(`${label} 的输出长度必须是 ${expectedLength} 字节`);
    return encodeUnsigned(BigInt(crc(input, field.parameters)), field.byte_length, field.byte_order, label);
  }
  if (field.method === "sum") {
    const modulus = 1n << BigInt(field.byte_length * 8);
    let sum = 0n;
    for (const byte of input) sum = (sum + BigInt(byte)) % modulus;
    return encodeUnsigned(sum, field.byte_length, field.byte_order, label);
  }
  if (field.method === "xor") {
    let value = 0;
    for (const byte of input) value ^= byte;
    return encodeUnsigned(BigInt(value), field.byte_length, field.byte_order, label);
  }
  return runCustomChecksum(field, input);
}

function runCustomChecksum(field: HexFrameChecksumField, input: Buffer): Buffer {
  if (!field.script.trim()) throw new Error(`${field.name || "自定义 JS 校验"} 的脚本不能为空`);
  let result: unknown;
  try {
    result = executeCustomChecksumScript(field.script, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${field.name || "自定义 JS 校验"} 执行失败：${message}`);
  }

  if (typeof result === "string") {
    const output = parseFieldHex(result, field.name || "自定义 JS 校验");
    if (output.length !== field.byte_length) {
      throw new Error(`${field.name || "自定义 JS 校验"} 必须返回 ${field.byte_length} 字节 HEX 字符串`);
    }
    return output;
  }
  if (typeof result === "number") {
    if (!Number.isSafeInteger(result) || result < 0) {
      throw new Error(`${field.name || "自定义 JS 校验"} 必须返回非负安全整数、BigInt 或 HEX 字符串`);
    }
    return encodeUnsigned(BigInt(result), field.byte_length, field.byte_order, field.name || "自定义 JS 校验");
  }
  if (typeof result === "bigint") {
    return encodeUnsigned(result, field.byte_length, field.byte_order, field.name || "自定义 JS 校验");
  }
  throw new Error(`${field.name || "自定义 JS 校验"} 必须返回非负整数、BigInt 或 HEX 字符串`);
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
      return Buffer.alloc(field.byte_length);
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
  if (field.source === "generated" && !field.generator) {
    throw new Error(`${field.name || "数据字段"} 缺少自定义生成配置`);
  }
  if (field.source === "generated") validateGeneratedValue(field, value);
  if (field.data_type === "hex") {
    let data = parseFieldHex(value, field.name);
    if (field.byte_length !== null && data.length !== field.byte_length) {
      throw new Error(`${field.name || "数据字段"} 必须是 ${field.byte_length} 字节`);
    }
    if (field.byte_order === "little" && data.length > 1) data = Buffer.from(data).reverse();
    return data;
  }
  if (field.data_type === "text") {
    const data = encodePayload(value, "text", field.text_encoding ?? "utf-8", "none");
    if (field.byte_length !== null && data.length !== field.byte_length) {
      throw new Error(`${field.name || "字符串字段"} 编码后必须是 ${field.byte_length} 字节，当前为 ${data.length} 字节`);
    }
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
  if (field.data_type === "bcd") {
    if (field.byte_length === null) throw new Error(`${field.name || "BCD 字段"} 必须选择字节长度`);
    return encodeBcd(value, field.byte_length, field.byte_order, field.name || "BCD 字段");
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

function validateGeneratedValue(field: Extract<HexFrameField, { kind: "data" }>, value: string): void {
  const generator = field.generator!;
  if (generator.control === "enum") {
    const allowedValues = generator.options
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.slice(item.lastIndexOf("=") + 1).trim());
    if (!allowedValues.includes(value.trim())) {
      throw new Error(`${field.name || "枚举字段"} 的当前值不在枚举选项中`);
    }
    return;
  }
  if (generator.control !== "uint_slider" && generator.control !== "int_slider"
    && generator.control !== "float32_slider" && generator.control !== "float64_slider"
    && generator.control !== "bcd_slider") return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${field.name || "生成字段"} 必须是有效数字`);
  if (numeric < generator.minimum || numeric > generator.maximum) {
    throw new Error(`${field.name || "生成字段"} 必须位于 ${generator.minimum} 到 ${generator.maximum} 之间`);
  }
  const steps = (numeric - generator.minimum) / generator.step;
  const nearestValue = generator.minimum + Math.round(steps) * generator.step;
  const scale = Math.max(1, Math.abs(numeric), Math.abs(generator.minimum), Math.abs(nearestValue));
  const tolerance = Math.max(generator.step * 1e-9, Number.EPSILON * scale * 16);
  if (Math.abs(numeric - nearestValue) > tolerance) {
    throw new Error(`${field.name || "生成字段"} 不符合步进精度 ${generator.step}`);
  }
}

function encodeBcd(value: string, byteLength: number, byteOrder: ByteOrder, label: string): Buffer {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`${label} 必须是非负十进制数`);
  const digits = normalized.replace(".", "");
  if (digits.length > byteLength * 2) throw new Error(`${label} 超出 ${byteLength} 字节 BCD 范围`);
  const data = Buffer.from(digits.padStart(byteLength * 2, "0"), "hex");
  return byteOrder === "little" ? data.reverse() : data;
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

function parseCrcValue(value: string, width: number, label: string): number {
  const parsed = parseUnsignedHex(value, label);
  const maximum = (1n << BigInt(width)) - 1n;
  if (parsed > maximum) throw new Error(`${label} 超出 ${width} 位范围`);
  return Number(parsed);
}

function reflectBits(value: number, width: number): number {
  let reflected = 0;
  for (let bit = 0; bit < width; bit += 1) {
    reflected = ((reflected << 1) | ((value >>> bit) & 1)) >>> 0;
  }
  return reflected;
}

function ensureUniqueFieldIds(fields: HexFrameField[]): void {
  const ids = new Set<string>();
  for (const field of fields) {
    if (ids.has(field.id)) throw new Error(`帧字段 ID 重复：${field.id}`);
    ids.add(field.id);
  }
}
