import { z } from "zod";

const trimmedHost = z.string().trim().min(1).max(253);
const port = z.number().int().min(1).max(65_535);
const bindPort = z.number().int().min(0).max(65_535);
const frameFieldId = z.string().min(1).max(80);
const frameFieldName = z.string().max(60);
const hexString = z.string().max(2_097_152);
const byteOrder = z.enum(["big", "little"]);
const frameByteLength = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(8),
]);
const crcWidth = z.union([z.literal(8), z.literal(16), z.literal(32)]);
const frameRange = {
  range_start_id: frameFieldId.nullable().default(null),
  range_end_id: frameFieldId.nullable().default(null),
};

const staticFrameFieldSchema = z.object({
  id: frameFieldId,
  name: frameFieldName,
  kind: z.enum(["header", "frame_id", "tail"]),
  value: hexString,
});

const sequenceFrameFieldSchema = z.object({
  id: frameFieldId,
  name: frameFieldName,
  kind: z.literal("sequence"),
  byte_length: frameByteLength,
  value: hexString,
  step: z.number().int().min(1).max(65_535),
  byte_order: byteOrder,
});

const lengthFrameFieldSchema = z.object({
  id: frameFieldId,
  name: frameFieldName,
  kind: z.literal("length"),
  byte_length: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  byte_order: byteOrder,
  ...frameRange,
});

const frameGeneratorSchema = z.object({
  control: z.enum(["none", "uint_slider", "int_slider", "float32_slider", "float64_slider", "bit_checkboxes", "bit_radio", "byte_switches", "enum", "bcd_slider"]),
  control_name: z.string().max(60),
  minimum: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  maximum: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  step: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),
  options: z.string().max(8_192),
}).refine((value) => value.minimum <= value.maximum, {
  message: "生成控件最小值不能大于最大值",
});

const dataFrameFieldSchema = z.object({
  id: frameFieldId,
  name: frameFieldName,
  kind: z.literal("data"),
  byte_length: frameByteLength.nullable(),
  source: z.enum(["fixed", "editor", "generated"]),
  data_type: z.enum(["hex", "uint", "int", "float32", "float64", "bcd"]),
  value: hexString,
  byte_order: byteOrder,
  generator: frameGeneratorSchema.optional(),
});

const crcParametersSchema = z.object({
  preset: z.enum(["crc8", "crc8_maxim", "modbus", "arc", "ccitt_false", "xmodem", "x25", "kermit", "crc32", "crc32_mpeg2", "custom"]),
  width: crcWidth.default(16),
  polynomial: z.string().min(1).max(10),
  initial: z.string().min(1).max(10),
  xor_out: z.string().min(1).max(10),
  reflect_input: z.boolean(),
  reflect_output: z.boolean(),
});

const checksumFrameFieldSchema = z.object({
  id: frameFieldId,
  name: frameFieldName,
  kind: z.literal("checksum"),
  method: z.enum(["crc", "sum", "xor", "custom_js"]).default("crc"),
  byte_length: frameByteLength.default(2),
  parameters: crcParametersSchema,
  script: z.string().max(16_384).default(""),
  byte_order: byteOrder,
  ...frameRange,
}).superRefine((field, context) => {
  if (field.method === "crc" && field.byte_length !== field.parameters.width / 8) {
    context.addIssue({
      code: "custom",
      path: ["byte_length"],
      message: "CRC 输出长度必须与 CRC 位宽一致",
    });
  }
});

export const hexFrameConfigSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(80),
  enabled: z.boolean(),
  fields: z.discriminatedUnion("kind", [
    staticFrameFieldSchema,
    sequenceFrameFieldSchema,
    lengthFrameFieldSchema,
    dataFrameFieldSchema,
    checksumFrameFieldSchema,
  ]).array().max(64),
});

export const serialConfigSchema = z.object({
  mode: z.literal("serial"),
  port: z.string().trim().min(1).max(260),
  baudrate: z.number().int().min(50).max(4_000_000).default(115_200),
  bytesize: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).default(8),
  parity: z.enum(["N", "E", "O", "M", "S"]).default("N"),
  stopbits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).default(1),
  receive_idle_ms: z.number().int().min(1).max(1_000).default(20),
});

export const tcpClientConfigSchema = z.object({
  mode: z.literal("tcp_client"),
  host: trimmedHost,
  port,
  connect_timeout: z.number().positive().max(60).default(8),
  auto_reconnect: z.boolean().default(false),
});

export const tcpServerConfigSchema = z.object({
  mode: z.literal("tcp_server"),
  host: trimmedHost.default("0.0.0.0"),
  port: bindPort,
});

export const udpConfigSchema = z.object({
  mode: z.literal("udp"),
  local_host: trimmedHost.default("0.0.0.0"),
  local_port: bindPort.default(0),
  remote_host: z.string().trim().max(253).nullable().default(null)
    .transform((value) => value || null),
  remote_port: port.nullable().default(null),
}).refine(
  (value) => (value.remote_host === null) === (value.remote_port === null),
  { message: "UDP 远端地址和端口必须同时填写或同时留空" },
);

export const transportConfigSchema = z.discriminatedUnion("mode", [
  serialConfigSchema,
  tcpClientConfigSchema,
  tcpServerConfigSchema,
  udpConfigSchema,
]);

export const sendRequestSchema = z.object({
  data: z.string().max(1_048_576),
  format: z.enum(["text", "hex"]).default("text"),
  text_encoding: z.enum(["utf-8", "ascii", "gbk"]).default("utf-8"),
  line_ending: z.enum(["none", "cr", "lf", "crlf"]).default("none"),
  frame_config: hexFrameConfigSchema.optional(),
});

export const periodicSendRequestSchema = sendRequestSchema.extend({
  interval_ms: z.number().int().min(10).max(86_400_000),
});

export const hexFramePreviewSchema = z.object({
  data: hexString,
  frame_config: hexFrameConfigSchema,
});
