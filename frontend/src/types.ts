export type TransportMode = "serial" | "tcp_client" | "tcp_server" | "udp";
export type DataFormat = "text" | "hex";
export type TextEncoding = "utf-8" | "ascii" | "gbk";
export type LineEnding = "none" | "cr" | "lf" | "crlf";

export interface SerialConfig {
  mode: "serial";
  port: string;
  baudrate: number;
  bytesize: 5 | 6 | 7 | 8;
  parity: "N" | "E" | "O" | "M" | "S";
  stopbits: 1 | 1.5 | 2;
}

export interface TcpClientConfig {
  mode: "tcp_client";
  host: string;
  port: number;
  connect_timeout: number;
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
