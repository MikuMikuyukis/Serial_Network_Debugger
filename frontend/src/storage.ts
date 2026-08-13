import type {
  SerialConfig,
  HexFrameField,
  HexFrameConfig,
  SendEditorDraft,
  SendPreset,
  TcpClientConfig,
  TcpServerConfig,
  TransportMode,
  UdpConfig,
} from "./types";

export type Theme = "light" | "dark";

export interface TransportSettings {
  version: 1;
  mode: TransportMode;
  serial: SerialConfig;
  tcpClient: TcpClientConfig;
  tcpServer: TcpServerConfig;
  udp: UdpConfig;
}

const SETTINGS_KEY = "snd.transport-settings.v1";
const THEME_KEY = "snd.theme";
const SEND_PRESETS_KEY = "snd.send-presets.v1";
const SEND_EDITOR_KEY = "snd.send-editor.v1";
const HEX_FRAME_CONFIG_KEY = "snd.hex-frame-config.v1";
export const MAX_SEND_PRESETS = 100;

export const DEFAULT_HEX_FRAME_CONFIG: HexFrameConfig = {
  version: 1,
  id: "default-frame",
  enabled: false,
  fields: [],
};

export const DEFAULT_SEND_EDITOR: SendEditorDraft = {
  version: 1,
  data: "",
  format: "text",
  text_encoding: "utf-8",
  line_ending: "none",
  interval_ms: 1000,
};

export const DEFAULT_TRANSPORT_SETTINGS: TransportSettings = {
  version: 1,
  mode: "serial",
  serial: {
    mode: "serial",
    port: "",
    baudrate: 115200,
    bytesize: 8,
    parity: "N",
    stopbits: 1,
    receive_idle_ms: 20,
  },
  tcpClient: {
    mode: "tcp_client",
    host: "127.0.0.1",
    port: 9000,
    connect_timeout: 8,
    auto_reconnect: false,
  },
  tcpServer: {
    mode: "tcp_server",
    host: "0.0.0.0",
    port: 9000,
  },
  udp: {
    mode: "udp",
    local_host: "0.0.0.0",
    local_port: 9000,
    remote_host: null,
    remote_port: null,
  },
};

export function cloneTransportSettings(settings: TransportSettings): TransportSettings {
  return {
    version: 1,
    mode: settings.mode,
    serial: { ...settings.serial },
    tcpClient: { ...settings.tcpClient },
    tcpServer: { ...settings.tcpServer },
    udp: { ...settings.udp },
  };
}

export function loadTransportSettings(): TransportSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<TransportSettings> | null;
    if (!stored || stored.version !== 1) return cloneTransportSettings(DEFAULT_TRANSPORT_SETTINGS);

    const defaults = DEFAULT_TRANSPORT_SETTINGS;
    const mode = isTransportMode(stored.mode) ? stored.mode : defaults.mode;
    return {
      version: 1,
      mode,
      serial: { ...defaults.serial, ...stored.serial, mode: "serial" },
      tcpClient: { ...defaults.tcpClient, ...stored.tcpClient, mode: "tcp_client" },
      tcpServer: { ...defaults.tcpServer, ...stored.tcpServer, mode: "tcp_server" },
      udp: { ...defaults.udp, ...stored.udp, mode: "udp" },
    };
  } catch {
    return cloneTransportSettings(DEFAULT_TRANSPORT_SETTINGS);
  }
}

export function saveTransportSettings(settings: TransportSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function loadSendPresets(): SendPreset[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SEND_PRESETS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    return stored
      .map(normalizeSendPreset)
      .filter((preset): preset is SendPreset => preset !== null)
      .slice(0, MAX_SEND_PRESETS);
  } catch {
    return [];
  }
}

export function saveSendPresets(presets: SendPreset[]): void {
  localStorage.setItem(SEND_PRESETS_KEY, JSON.stringify(presets.slice(0, MAX_SEND_PRESETS)));
}

export function loadSendEditor(): SendEditorDraft {
  try {
    const stored = JSON.parse(localStorage.getItem(SEND_EDITOR_KEY) ?? "null") as Partial<SendEditorDraft> | null;
    if (!stored || stored.version !== 1) return { ...DEFAULT_SEND_EDITOR };
    return {
      version: 1,
      data: typeof stored.data === "string" && stored.data.length <= 1_048_576
        ? stored.data
        : DEFAULT_SEND_EDITOR.data,
      format: stored.format === "hex" ? "hex" : "text",
      text_encoding: stored.text_encoding === "ascii" || stored.text_encoding === "gbk"
        ? stored.text_encoding
        : "utf-8",
      line_ending: stored.line_ending === "cr" || stored.line_ending === "lf" || stored.line_ending === "crlf"
        ? stored.line_ending
        : "none",
      interval_ms: isValidInterval(stored.interval_ms) ? stored.interval_ms : DEFAULT_SEND_EDITOR.interval_ms,
    };
  } catch {
    return { ...DEFAULT_SEND_EDITOR };
  }
}

export function saveSendEditor(editor: SendEditorDraft): void {
  localStorage.setItem(SEND_EDITOR_KEY, JSON.stringify(editor));
}

export function loadHexFrameConfig(): HexFrameConfig {
  try {
    const stored = JSON.parse(localStorage.getItem(HEX_FRAME_CONFIG_KEY) ?? "null") as unknown;
    return normalizeHexFrameConfig(stored) ?? structuredClone(DEFAULT_HEX_FRAME_CONFIG);
  } catch {
    return structuredClone(DEFAULT_HEX_FRAME_CONFIG);
  }
}

export function saveHexFrameConfig(config: HexFrameConfig): void {
  localStorage.setItem(HEX_FRAME_CONFIG_KEY, JSON.stringify(config));
}

function normalizeHexFrameConfig(value: unknown): HexFrameConfig | null {
  if (!value || typeof value !== "object") return null;
  const config = value as Partial<HexFrameConfig>;
  if (config.version !== 1 || !isBoundedString(config.id, 1, 80)) return null;
  if (typeof config.enabled !== "boolean" || !Array.isArray(config.fields)) return null;
  if (config.fields.length > 64) return null;
  const fields = config.fields.map(normalizeHexFrameField);
  if (fields.some((field) => field === null)) return null;
  const normalizedFields = fields as HexFrameField[];
  const ids = new Set(normalizedFields.map((field) => field.id));
  if (ids.size !== normalizedFields.length) return null;
  for (const field of normalizedFields) {
    if (field.kind !== "length" && field.kind !== "checksum") continue;
    if (field.range_start_id !== null && !ids.has(field.range_start_id)) return null;
    if (field.range_end_id !== null && !ids.has(field.range_end_id)) return null;
  }
  return { version: 1, id: config.id, enabled: config.enabled, fields: normalizedFields };
}

function normalizeHexFrameField(value: unknown): HexFrameField | null {
  if (!value || typeof value !== "object") return null;
  const field = value as Record<string, unknown>;
  if (!isBoundedString(field.id, 1, 80) || !isBoundedString(field.name, 0, 60)) return null;
  const base = { id: field.id, name: field.name };
  if (field.kind === "header" || field.kind === "frame_id" || field.kind === "tail") {
    return isBoundedString(field.value, 0, 2_097_152)
      ? { ...base, kind: field.kind, value: field.value }
      : null;
  }
  if (field.kind === "sequence") {
    return isFrameByteLength(field.byte_length)
      && isBoundedString(field.value, 0, 2_097_152)
      && isIntegerInRange(field.step, 1, 65_535)
      && isByteOrder(field.byte_order)
      ? { ...base, kind: field.kind, byte_length: field.byte_length, value: field.value, step: field.step, byte_order: field.byte_order }
      : null;
  }
  if (field.kind === "length") {
    return isIntegerInRange(field.byte_length, 1, 4)
      && isByteOrder(field.byte_order)
      && isFrameRangeId(field.range_start_id)
      && isFrameRangeId(field.range_end_id)
      ? { ...base, kind: field.kind, byte_length: field.byte_length as 1 | 2 | 3 | 4, byte_order: field.byte_order, range_start_id: field.range_start_id, range_end_id: field.range_end_id }
      : null;
  }
  if (field.kind === "data") {
    const byteLength = field.byte_length;
    const source = field.source;
    const dataType = field.data_type;
    return (byteLength === null || isFrameByteLength(byteLength))
      && isDataSource(source)
      && isFrameDataType(dataType)
      && isBoundedString(field.value, 0, 2_097_152)
      && isByteOrder(field.byte_order)
      ? { ...base, kind: field.kind, byte_length: byteLength, source, data_type: dataType, value: field.value, byte_order: field.byte_order }
      : null;
  }
  if (field.kind === "checksum") {
    const parameters = field.parameters;
    if (!parameters || typeof parameters !== "object") return null;
    const crc = parameters as Record<string, unknown>;
    const preset = crc.preset;
    return isCrcPreset(preset)
      && isBoundedString(crc.polynomial, 1, 6)
      && isBoundedString(crc.initial, 1, 6)
      && isBoundedString(crc.xor_out, 1, 6)
      && typeof crc.reflect_input === "boolean"
      && typeof crc.reflect_output === "boolean"
      && isByteOrder(field.byte_order)
      && isFrameRangeId(field.range_start_id)
      && isFrameRangeId(field.range_end_id)
      ? {
          ...base,
          kind: field.kind,
          parameters: {
            preset,
            polynomial: crc.polynomial,
            initial: crc.initial,
            xor_out: crc.xor_out,
            reflect_input: crc.reflect_input,
            reflect_output: crc.reflect_output,
          },
          byte_order: field.byte_order,
          range_start_id: field.range_start_id,
          range_end_id: field.range_end_id,
        }
      : null;
  }
  return null;
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isFrameByteLength(value: unknown): value is 1 | 2 | 3 | 4 | 8 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 8;
}

function isByteOrder(value: unknown): value is "big" | "little" {
  return value === "big" || value === "little";
}

function isDataSource(value: unknown): value is "fixed" | "editor" {
  return value === "fixed" || value === "editor";
}

function isFrameDataType(value: unknown): value is "hex" | "uint" | "int" | "float32" | "float64" {
  return value === "hex" || value === "uint" || value === "int" || value === "float32" || value === "float64";
}

function isCrcPreset(value: unknown): value is "modbus" | "arc" | "ccitt_false" | "xmodem" | "x25" | "kermit" | "custom" {
  return value === "modbus" || value === "arc" || value === "ccitt_false" || value === "xmodem" || value === "x25" || value === "kermit" || value === "custom";
}

function isFrameRangeId(value: unknown): value is string | null {
  return value === null || isBoundedString(value, 1, 80);
}

function isTransportMode(value: unknown): value is TransportMode {
  return value === "serial" || value === "tcp_client" || value === "tcp_server" || value === "udp";
}

function normalizeSendPreset(value: unknown): SendPreset | null {
  if (!value || typeof value !== "object") return null;
  const preset = value as Partial<SendPreset>;
  const valid = typeof preset.id === "string"
    && preset.id.length > 0
    && typeof preset.name === "string"
    && preset.name.length <= 60
    && typeof preset.data === "string"
    && preset.data.length <= 1_048_576
    && (preset.format === "text" || preset.format === "hex")
    && (preset.text_encoding === "utf-8" || preset.text_encoding === "ascii" || preset.text_encoding === "gbk")
    && (preset.line_ending === "none" || preset.line_ending === "cr" || preset.line_ending === "lf" || preset.line_ending === "crlf")
    && typeof preset.updated_at === "string";
  if (!valid) return null;
  const frameConfig = preset.frame_config === undefined
    ? undefined
    : normalizeHexFrameConfig(preset.frame_config) ?? undefined;
  return {
    id: preset.id!,
    name: preset.name!,
    data: preset.data!,
    format: preset.format!,
    text_encoding: preset.text_encoding!,
    line_ending: preset.line_ending!,
    enabled: typeof preset.enabled === "boolean" ? preset.enabled : true,
    delay_ms: isValidDelay(preset.delay_ms) ? preset.delay_ms : 50,
    updated_at: preset.updated_at!,
    ...(frameConfig ? { frame_config: frameConfig } : {}),
  };
}

function isValidInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 86_400_000;
}

function isValidDelay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 86_400_000;
}
