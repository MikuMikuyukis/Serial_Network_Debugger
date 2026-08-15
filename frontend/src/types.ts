export type TransportMode = "serial" | "tcp_client" | "tcp_server" | "udp";
export type DataFormat = "text" | "hex";
export type TextEncoding = "utf-8" | "ascii" | "gbk";
export type LineEnding = "none" | "cr" | "lf" | "crlf";
export type ByteOrder = "big" | "little";
export type FrameByteLength = 1 | 2 | 3 | 4 | 8;
export type ChecksumMethod = "crc" | "sum" | "xor" | "custom_js";
export type CrcWidth = 8 | 16 | 32;
export type FrameGeneratorControl = "none" | "uint_slider" | "int_slider" | "float32_slider" | "float64_slider" | "bit_checkboxes" | "bit_radio" | "byte_switches" | "enum" | "bcd_slider";

export interface HexFrameGenerator {
  control: FrameGeneratorControl;
  control_name: string;
  minimum: number;
  maximum: number;
  step: number;
  options: string;
}

interface HexFrameFieldBase {
  id: string;
  name: string;
}

export interface HexFrameStaticField extends HexFrameFieldBase {
  kind: "header" | "frame_id" | "tail";
  value: string;
}

export interface HexFrameSequenceField extends HexFrameFieldBase {
  kind: "sequence";
  byte_length: FrameByteLength;
  value: string;
  step: number;
  byte_order: ByteOrder;
}

export interface HexFrameLengthField extends HexFrameFieldBase {
  kind: "length";
  byte_length: 1 | 2 | 3 | 4;
  byte_order: ByteOrder;
  range_start_id: string | null;
  range_end_id: string | null;
}

export interface HexFrameDataField extends HexFrameFieldBase {
  kind: "data";
  byte_length: FrameByteLength | null;
  source: "fixed" | "editor" | "generated";
  data_type: "hex" | "text" | "uint" | "int" | "float32" | "float64" | "bcd";
  text_encoding?: TextEncoding;
  value: string;
  byte_order: ByteOrder;
  generator?: HexFrameGenerator;
}

export interface CrcParameters {
  preset: "crc8" | "crc8_maxim" | "modbus" | "arc" | "ccitt_false" | "xmodem" | "x25" | "kermit" | "crc32" | "crc32_mpeg2" | "custom";
  width: CrcWidth;
  polynomial: string;
  initial: string;
  xor_out: string;
  reflect_input: boolean;
  reflect_output: boolean;
}

export interface HexFrameChecksumField extends HexFrameFieldBase {
  kind: "checksum";
  method: ChecksumMethod;
  byte_length: FrameByteLength;
  parameters: CrcParameters;
  script: string;
  byte_order: ByteOrder;
  range_start_id: string | null;
  range_end_id: string | null;
}

export type HexFrameField =
  | HexFrameStaticField
  | HexFrameSequenceField
  | HexFrameLengthField
  | HexFrameDataField
  | HexFrameChecksumField;

export interface HexFrameConfig {
  version: 1;
  id: string;
  enabled: boolean;
  fields: HexFrameField[];
}

export interface SerialConfig {
  mode: "serial";
  port: string;
  baudrate: number;
  bytesize: 5 | 6 | 7 | 8;
  parity: "N" | "E" | "O" | "M" | "S";
  stopbits: 1 | 1.5 | 2;
  receive_idle_ms: number;
}

export interface TcpClientConfig {
  mode: "tcp_client";
  host: string;
  port: number;
  connect_timeout: number;
  auto_reconnect: boolean;
}

export interface TcpServerConfig {
  mode: "tcp_server";
  host: string;
  port: number;
}

export interface UdpConfig {
  mode: "udp";
  local_host: string;
  local_port: number;
  remote_host: string | null;
  remote_port: number | null;
}

export type TransportConfig = SerialConfig | TcpClientConfig | TcpServerConfig | UdpConfig;

export interface TransportStatus {
  connected: boolean;
  mode: TransportMode | null;
  rx_bytes: number;
  tx_bytes: number;
  details: Record<string, unknown>;
}

export interface SerialPortInfo {
  device: string;
  description: string | null;
  manufacturer: string | null;
  hwid: string | null;
}

export interface SendPayload {
  data: string;
  format: DataFormat;
  text_encoding: TextEncoding;
  line_ending: LineEnding;
  frame_config?: HexFrameConfig;
}

export interface PeriodicSendRequest extends SendPayload {
  interval_ms: number;
  frame_config?: HexFrameConfig;
}

export interface PeriodicSendStatus {
  active: boolean;
  interval_ms: number | null;
  sent_count: number;
  started_at: string | null;
  last_sent_at: string | null;
  frame_sequences: Record<string, string> | null;
}

export interface SendPreset extends SendPayload {
  id: string;
  name: string;
  enabled: boolean;
  auto_send_on_change: boolean;
  delay_ms: number;
  updated_at: string;
}

export type SendPresetDraft = Omit<SendPreset, "id" | "updated_at">;

export interface SendEditorDraft extends SendPayload {
  version: 1;
  interval_ms: number;
}

export type FrameParserDataType = "uint" | "int" | "float32" | "float64" | "bcd" | "boolean" | "hex" | "text" | "ascii";
export type FrameParserDisplay = "number" | "gauge" | "trend" | "bar" | "status";
export type FrameParserFieldKind = "fixed" | "value" | "skip";
export type FrameParserLengthMode = "fixed" | "remaining" | "field";

export interface FrameParserField {
  id: string;
  name: string;
  kind: FrameParserFieldKind;
  offset: number;
  byte_length: number;
  length_mode: FrameParserLengthMode;
  length_field_id: string | null;
  match_hex: string;
  data_type: FrameParserDataType;
  text_encoding: TextEncoding;
  byte_order: ByteOrder;
  bit_index: number;
  scale: number;
  value_offset: number;
  decimals: number;
  unit: string;
  visible: boolean;
  display: FrameParserDisplay;
  minimum: number;
  maximum: number;
  color: string;
}

export interface FrameParserConfig {
  version: 1;
  id: string;
  name: string;
  enabled: boolean;
  minimum_length: number;
  match_offset: number;
  match_hex: string;
  fields: FrameParserField[];
}

export interface ReceivedFrame {
  id: number;
  timestamp: string;
  hex: string;
  peer: string;
  size: number;
}

export interface ParsedFieldValue {
  field_id: string;
  offset: number;
  byte_length: number;
  raw: string;
  value: number | string | boolean;
  numeric: number | null;
  formatted: string;
}

export interface FrameParseResult {
  status: "matched" | "unmatched" | "error";
  message: string;
  values: ParsedFieldValue[];
}

export interface LogItem {
  id: number;
  time: string;
  kind: "rx" | "tx" | "info" | "error";
  text: string;
  hex: string;
  peer: string;
  size: number;
}

export type ServerEvent =
  | { type: "status"; status: TransportStatus }
  | { type: "periodic_status"; status: PeriodicSendStatus }
  | {
      type: "data";
      timestamp?: string;
      direction: "rx" | "tx";
      text: string;
      hex: string;
      peer?: string;
      size: number;
    }
  | { type: "error" | "notice"; timestamp?: string; message: string }
  | { type: "ping" };
