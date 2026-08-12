import type {
  SerialConfig,
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
export const MAX_SEND_PRESETS = 100;

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
  };
}

function isValidInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 86_400_000;
}

function isValidDelay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 86_400_000;
}
