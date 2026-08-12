import { z } from "zod";

const trimmedHost = z.string().trim().min(1).max(253);
const port = z.number().int().min(1).max(65_535);
const bindPort = z.number().int().min(0).max(65_535);

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
});

export const periodicSendRequestSchema = sendRequestSchema.extend({
  interval_ms: z.number().int().min(10).max(86_400_000),
});
