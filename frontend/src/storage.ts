import type {
  SerialConfig,
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

function isTransportMode(value: unknown): value is TransportMode {
  return value === "serial" || value === "tcp_client" || value === "tcp_server" || value === "udp";
}
