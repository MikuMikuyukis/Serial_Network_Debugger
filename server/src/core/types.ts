export type TransportMode = "serial" | "tcp_client" | "tcp_server" | "udp";
export type DataFormat = "text" | "hex";
export type TextEncoding = "utf-8" | "ascii" | "gbk";
export type LineEnding = "none" | "cr" | "lf" | "crlf";
export type ByteOrder = "big" | "little";
export type FrameByteLength = 1 | 2 | 3 | 4 | 8;

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
  source: "fixed" | "editor";
  data_type: "hex" | "uint" | "int" | "float32" | "float64";
  value: string;
  byte_order: ByteOrder;
}

export interface Crc16Parameters {
  preset: "modbus" | "arc" | "ccitt_false" | "xmodem" | "x25" | "kermit" | "custom";
  polynomial: string;
  initial: string;
  xor_out: string;
  reflect_input: boolean;
  reflect_output: boolean;
}

export interface HexFrameChecksumField extends HexFrameFieldBase {
  kind: "checksum";
  parameters: Crc16Parameters;
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

export interface SendRequest {
  data: string;
  format: DataFormat;
  text_encoding: TextEncoding;
  line_ending: LineEnding;
  frame_config?: HexFrameConfig;
}

export interface PeriodicSendRequest extends SendRequest {
  interval_ms: number;
}

export interface PeriodicSendStatus {
  active: boolean;
  interval_ms: number | null;
  sent_count: number;
  started_at: string | null;
  last_sent_at: string | null;
  frame_sequences: Record<string, string> | null;
}

export interface TransportStatus {
  connected: boolean;
  mode: TransportMode | null;
  rx_bytes: number;
  tx_bytes: number;
  details: Record<string, unknown>;
}

export interface BaseEvent {
  type: string;
  timestamp?: string;
  transport?: TransportMode;
}

export interface StatusEvent extends BaseEvent {
  type: "status";
  status: TransportStatus;
}

export interface DataEvent extends BaseEvent {
  type: "data";
  direction: "rx" | "tx";
  transport: TransportMode;
  size: number;
  hex: string;
  text: string;
  peer?: string;
}

export interface MessageEvent extends BaseEvent {
  type: "error" | "notice";
  transport?: TransportMode;
  message: string;
}

export interface PingEvent extends BaseEvent {
  type: "ping";
}

export interface PeriodicStatusEvent extends BaseEvent {
  type: "periodic_status";
  status: PeriodicSendStatus;
}

export type ServerEvent = StatusEvent | DataEvent | MessageEvent | PingEvent | PeriodicStatusEvent;
