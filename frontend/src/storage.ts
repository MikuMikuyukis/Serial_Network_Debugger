import type {
  SerialConfig,
  HexFrameField,
  HexFrameConfig,
  FrameParserConfig,
  FrameParserDataType,
  FrameParserDisplay,
  FrameParserField,
  SendEditorDraft,
  SendPreset,
  TcpClientConfig,
  TcpServerConfig,
  TransportMode,
  UdpConfig,
} from "./types";
import { validateFrameParserConfig } from "./frame-parser";

export type Theme = "light" | "dark";

export interface TransportSettings {
  version: 1;
  mode: TransportMode;
  serial: SerialConfig;
  tcpClient: TcpClientConfig;
  tcpServer: TcpServerConfig;
  udp: UdpConfig;
}

export interface ConfigurationProfile {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export type PresetColumnId = "enabled" | "name" | "data" | "format" | "delay" | "actions";

export interface LayoutPreferences {
  version: 1;
  tool_panel_ratio: number;
  preset_columns: Record<PresetColumnId, number>;
}

export interface ConfigurationBackupProfile {
  metadata: ConfigurationProfile;
  transport: TransportSettings;
  send_editor: SendEditorDraft;
  hex_frame: HexFrameConfig;
  send_presets: SendPreset[];
  frame_parser: FrameParserConfig;
}

export interface ConfigurationBackup {
  application: "serial-network-debugger";
  version: 1;
  exported_at: string;
  theme: Theme;
  active_profile_id: string;
  profiles: ConfigurationBackupProfile[];
}

const SETTINGS_KEY = "snd.transport-settings.v1";
const THEME_KEY = "snd.theme";
const SEND_PRESETS_KEY = "snd.send-presets.v1";
const SEND_EDITOR_KEY = "snd.send-editor.v1";
const HEX_FRAME_CONFIG_KEY = "snd.hex-frame-config.v1";
export const FRAME_PARSER_CONFIG_KEY = "snd.frame-parser-config.v1";
const PROFILES_KEY = "snd.configuration-profiles.v1";
const ACTIVE_PROFILE_KEY = "snd.active-configuration-profile.v1";
export const LAYOUT_PREFERENCES_KEY = "snd.layout-preferences.v1";
const DEFAULT_PROFILE_ID = "default";
const BACKUP_APPLICATION = "serial-network-debugger";
const BACKUP_VERSION = 1;
export const CONFIGURATION_IMPORT_EVENT_KEY = "snd.configuration-import.v1";
export const MAX_CONFIGURATION_PROFILES = 20;
export const MAX_SEND_PRESETS = 100;

export const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  version: 1,
  tool_panel_ratio: 0.575,
  preset_columns: {
    enabled: 70,
    name: 112,
    data: 280,
    format: 188,
    delay: 92,
    actions: 134,
  },
};

export const PRESET_COLUMN_LIMITS: Record<PresetColumnId, { minimum: number; maximum: number }> = {
  enabled: { minimum: 64, maximum: 240 },
  name: { minimum: 80, maximum: 800 },
  data: { minimum: 120, maximum: 1_600 },
  format: { minimum: 150, maximum: 480 },
  delay: { minimum: 80, maximum: 320 },
  actions: { minimum: 126, maximum: 360 },
};

export const DEFAULT_HEX_FRAME_CONFIG: HexFrameConfig = {
  version: 1,
  id: "default-frame",
  enabled: false,
  fields: [],
};

export const DEFAULT_FRAME_PARSER_CONFIG: FrameParserConfig = {
  version: 1,
  id: "default-parser",
  name: "接收帧解析",
  enabled: false,
  minimum_length: 0,
  match_offset: 0,
  match_hex: "",
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

export function loadLayoutPreferences(): LayoutPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYOUT_PREFERENCES_KEY) ?? "null") as unknown;
    if (!stored || typeof stored !== "object") return structuredClone(DEFAULT_LAYOUT_PREFERENCES);
    const preferences = stored as Partial<LayoutPreferences>;
    const columns = preferences.preset_columns;
    if (preferences.version !== 1 || !columns || typeof columns !== "object") {
      return structuredClone(DEFAULT_LAYOUT_PREFERENCES);
    }
    return {
      version: 1,
      tool_panel_ratio: isFiniteNumber(preferences.tool_panel_ratio)
        && preferences.tool_panel_ratio >= 0.2
        && preferences.tool_panel_ratio <= 0.8
        ? preferences.tool_panel_ratio
        : DEFAULT_LAYOUT_PREFERENCES.tool_panel_ratio,
      preset_columns: {
        enabled: normalizePresetColumnWidth("enabled", columns.enabled),
        name: normalizePresetColumnWidth("name", columns.name),
        data: normalizePresetColumnWidth("data", columns.data),
        format: normalizePresetColumnWidth("format", columns.format),
        delay: normalizePresetColumnWidth("delay", columns.delay),
        actions: normalizePresetColumnWidth("actions", columns.actions),
      },
    };
  } catch {
    return structuredClone(DEFAULT_LAYOUT_PREFERENCES);
  }
}

export function saveLayoutPreferences(preferences: LayoutPreferences): void {
  localStorage.setItem(LAYOUT_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function clampPresetColumnWidth(column: PresetColumnId, value: number): number {
  const limits = PRESET_COLUMN_LIMITS[column];
  if (!Number.isFinite(value)) return DEFAULT_LAYOUT_PREFERENCES.preset_columns[column];
  return Math.min(limits.maximum, Math.max(limits.minimum, Math.round(value)));
}

export function loadConfigurationProfiles(): ConfigurationProfile[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? "[]") as unknown;
    if (Array.isArray(stored)) {
      const profiles = stored
        .map(normalizeConfigurationProfile)
        .filter((profile): profile is ConfigurationProfile => profile !== null)
        .slice(0, MAX_CONFIGURATION_PROFILES);
      if (profiles.length > 0) return profiles;
    }
  } catch {
    // Fall through and migrate the legacy unscoped settings into the default profile.
  }
  const now = new Date().toISOString();
  const profiles = [{ id: DEFAULT_PROFILE_ID, name: "默认配置", created_at: now, updated_at: now }];
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // The caller can still use the in-memory default when local storage is unavailable.
  }
  return profiles;
}

export function saveConfigurationProfiles(profiles: ConfigurationProfile[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles.slice(0, MAX_CONFIGURATION_PROFILES)));
}

export function loadActiveProfileId(): string {
  const profiles = loadConfigurationProfiles();
  const stored = localStorage.getItem(ACTIVE_PROFILE_KEY);
  return profiles.some((profile) => profile.id === stored) ? stored! : profiles[0]!.id;
}

export function saveActiveProfileId(profileId: string): void {
  localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
}

export function createConfigurationBackup(): ConfigurationBackup {
  const profiles = loadConfigurationProfiles();
  const storedTheme = localStorage.getItem(THEME_KEY);
  const backup: ConfigurationBackup = {
    application: BACKUP_APPLICATION,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    theme: storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    active_profile_id: loadActiveProfileId(),
    profiles: profiles.map((metadata) => ({
      metadata,
      transport: loadTransportSettings(metadata.id),
      send_editor: loadSendEditor(metadata.id),
      hex_frame: loadHexFrameConfig(metadata.id),
      send_presets: loadSendPresets(metadata.id),
      frame_parser: loadFrameParserConfig(metadata.id),
    })),
  };
  const normalized = normalizeConfigurationBackup(backup);
  if (!normalized) throw new Error("当前保存的配置包含无效数据，无法导出");
  return normalized;
}

export function parseConfigurationBackup(serialized: string): ConfigurationBackup {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error("配置文件不是有效的 JSON");
  }
  const backup = normalizeConfigurationBackup(value);
  if (!backup) throw new Error("配置文件格式、版本或内容无效");
  return backup;
}

export function importConfigurationBackup(value: ConfigurationBackup): void {
  const backup = normalizeConfigurationBackup(value);
  if (!backup) throw new Error("配置文件格式、版本或内容无效");
  const previous = createConfigurationBackup();
  try {
    replaceConfigurationBackup(backup);
  } catch (error) {
    try {
      replaceConfigurationBackup(previous);
    } catch {
      // Preserve the original import error if browser storage is no longer writable.
    }
    throw error;
  }
  try {
    localStorage.setItem(CONFIGURATION_IMPORT_EVENT_KEY, createStorageId());
  } catch {
    // The importing window reloads itself even if cross-window notification is unavailable.
  }
}

export function copyConfigurationProfileData(sourceProfileId: string, targetProfileId: string): void {
  saveTransportSettings(loadTransportSettings(sourceProfileId), targetProfileId);
  const editor = loadSendEditor(sourceProfileId);
  const frameConfig = cloneFrameConfigWithNewId(loadHexFrameConfig(sourceProfileId), `profile-${targetProfileId}`);
  saveSendEditor({ ...editor, ...(editor.frame_config ? { frame_config: frameConfig } : {}) }, targetProfileId);
  saveHexFrameConfig(frameConfig, targetProfileId);
  saveSendPresets(loadSendPresets(sourceProfileId).map((preset) => ({
    ...structuredClone(preset),
    id: createStorageId(),
    ...(preset.frame_config
      ? { frame_config: cloneFrameConfigWithNewId(preset.frame_config, `preset-${targetProfileId}`) }
      : {}),
  })), targetProfileId);
  const parserConfig = loadFrameParserConfig(sourceProfileId);
  saveFrameParserConfig({ ...structuredClone(parserConfig), id: `parser-${createStorageId()}`.slice(0, 80) }, targetProfileId);
}

export function removeConfigurationProfileData(profileId: string): void {
  for (const key of [SETTINGS_KEY, SEND_PRESETS_KEY, SEND_EDITOR_KEY, HEX_FRAME_CONFIG_KEY, FRAME_PARSER_CONFIG_KEY]) {
    localStorage.removeItem(profileStorageKey(key, profileId));
    if (profileId === DEFAULT_PROFILE_ID) localStorage.removeItem(key);
  }
}

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

export function loadTransportSettings(profileId = DEFAULT_PROFILE_ID): TransportSettings {
  try {
    const stored = JSON.parse(readProfileItem(SETTINGS_KEY, profileId) ?? "null") as Partial<TransportSettings> | null;
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

export function saveTransportSettings(settings: TransportSettings, profileId = DEFAULT_PROFILE_ID): void {
  localStorage.setItem(profileStorageKey(SETTINGS_KEY, profileId), JSON.stringify(settings));
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

export function loadSendPresets(profileId = DEFAULT_PROFILE_ID): SendPreset[] {
  try {
    const stored = JSON.parse(readProfileItem(SEND_PRESETS_KEY, profileId) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    return stored
      .map(normalizeSendPreset)
      .filter((preset): preset is SendPreset => preset !== null)
      .slice(0, MAX_SEND_PRESETS);
  } catch {
    return [];
  }
}

export function saveSendPresets(presets: SendPreset[], profileId = DEFAULT_PROFILE_ID): void {
  localStorage.setItem(profileStorageKey(SEND_PRESETS_KEY, profileId), JSON.stringify(presets.slice(0, MAX_SEND_PRESETS)));
}

export function cloneSendPreset(preset: SendPreset): SendPreset {
  return JSON.parse(JSON.stringify(preset)) as SendPreset;
}

export function sendPresetsStorageKey(profileId = DEFAULT_PROFILE_ID): string {
  return profileStorageKey(SEND_PRESETS_KEY, profileId);
}

export function loadSendEditor(profileId = DEFAULT_PROFILE_ID): SendEditorDraft {
  try {
    const stored = JSON.parse(readProfileItem(SEND_EDITOR_KEY, profileId) ?? "null") as Partial<SendEditorDraft> | null;
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

export function saveSendEditor(editor: SendEditorDraft, profileId = DEFAULT_PROFILE_ID): void {
  localStorage.setItem(profileStorageKey(SEND_EDITOR_KEY, profileId), JSON.stringify(editor));
}

export function sendEditorStorageKey(profileId = DEFAULT_PROFILE_ID): string {
  return profileStorageKey(SEND_EDITOR_KEY, profileId);
}

export function loadHexFrameConfig(profileId = DEFAULT_PROFILE_ID): HexFrameConfig {
  try {
    const stored = JSON.parse(readProfileItem(HEX_FRAME_CONFIG_KEY, profileId) ?? "null") as unknown;
    return normalizeHexFrameConfig(stored) ?? structuredClone(DEFAULT_HEX_FRAME_CONFIG);
  } catch {
    return structuredClone(DEFAULT_HEX_FRAME_CONFIG);
  }
}

export function saveHexFrameConfig(config: HexFrameConfig, profileId = DEFAULT_PROFILE_ID): void {
  localStorage.setItem(profileStorageKey(HEX_FRAME_CONFIG_KEY, profileId), JSON.stringify(config));
}

export function hexFrameStorageKey(profileId = DEFAULT_PROFILE_ID): string {
  return profileStorageKey(HEX_FRAME_CONFIG_KEY, profileId);
}

export function loadFrameParserConfig(profileId = DEFAULT_PROFILE_ID): FrameParserConfig {
  try {
    const stored = JSON.parse(readProfileItem(FRAME_PARSER_CONFIG_KEY, profileId) ?? "null") as unknown;
    return normalizeFrameParserConfig(stored) ?? structuredClone(DEFAULT_FRAME_PARSER_CONFIG);
  } catch {
    return structuredClone(DEFAULT_FRAME_PARSER_CONFIG);
  }
}

export function saveFrameParserConfig(config: FrameParserConfig, profileId = DEFAULT_PROFILE_ID): void {
  localStorage.setItem(profileStorageKey(FRAME_PARSER_CONFIG_KEY, profileId), JSON.stringify(config));
}

export function frameParserStorageKey(profileId = DEFAULT_PROFILE_ID): string {
  return profileStorageKey(FRAME_PARSER_CONFIG_KEY, profileId);
}

function profileStorageKey(baseKey: string, profileId: string): string {
  return `snd.profile.${encodeURIComponent(profileId)}.${baseKey.slice(4)}`;
}

function cloneFrameConfigWithNewId(config: HexFrameConfig, prefix: string): HexFrameConfig {
  return { ...structuredClone(config), id: `${prefix}-${createStorageId()}`.slice(0, 80) };
}

function createStorageId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readProfileItem(baseKey: string, profileId: string): string | null {
  const scoped = localStorage.getItem(profileStorageKey(baseKey, profileId));
  if (scoped !== null) return scoped;
  return profileId === DEFAULT_PROFILE_ID ? localStorage.getItem(baseKey) : null;
}

function replaceConfigurationBackup(backup: ConfigurationBackup): void {
  const existingProfiles = loadConfigurationProfiles();
  for (const entry of backup.profiles) {
    const profileId = entry.metadata.id;
    saveTransportSettings(entry.transport, profileId);
    saveSendEditor(entry.send_editor, profileId);
    saveHexFrameConfig(entry.hex_frame, profileId);
    saveSendPresets(entry.send_presets, profileId);
    saveFrameParserConfig(entry.frame_parser, profileId);
  }
  saveConfigurationProfiles(backup.profiles.map((entry) => entry.metadata));
  saveActiveProfileId(backup.active_profile_id);
  localStorage.setItem(THEME_KEY, backup.theme);

  const importedIds = new Set(backup.profiles.map((entry) => entry.metadata.id));
  for (const profile of existingProfiles) {
    if (!importedIds.has(profile.id)) removeConfigurationProfileData(profile.id);
  }
  for (const key of [SETTINGS_KEY, SEND_PRESETS_KEY, SEND_EDITOR_KEY, HEX_FRAME_CONFIG_KEY, FRAME_PARSER_CONFIG_KEY]) {
    localStorage.removeItem(key);
  }
}

function normalizeConfigurationBackup(value: unknown): ConfigurationBackup | null {
  if (!value || typeof value !== "object") return null;
  const backup = value as Partial<ConfigurationBackup>;
  if (backup.application !== BACKUP_APPLICATION
    || backup.version !== BACKUP_VERSION
    || !isBoundedString(backup.exported_at, 1, 40)
    || Number.isNaN(Date.parse(backup.exported_at))
    || (backup.theme !== "light" && backup.theme !== "dark")
    || !isBoundedString(backup.active_profile_id, 1, 80)
    || !Array.isArray(backup.profiles)
    || backup.profiles.length < 1
    || backup.profiles.length > MAX_CONFIGURATION_PROFILES) return null;

  const profiles = backup.profiles.map(normalizeConfigurationBackupProfile);
  if (profiles.some((profile) => profile === null)) return null;
  const normalizedProfiles = profiles as ConfigurationBackupProfile[];
  const profileIds = normalizedProfiles.map((entry) => entry.metadata.id);
  if (new Set(profileIds).size !== profileIds.length || !profileIds.includes(backup.active_profile_id)) return null;
  return {
    application: BACKUP_APPLICATION,
    version: BACKUP_VERSION,
    exported_at: backup.exported_at,
    theme: backup.theme,
    active_profile_id: backup.active_profile_id,
    profiles: normalizedProfiles,
  };
}

function normalizeConfigurationBackupProfile(value: unknown): ConfigurationBackupProfile | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<ConfigurationBackupProfile>;
  const metadata = normalizeConfigurationProfile(entry.metadata);
  const transport = normalizeBackupTransportSettings(entry.transport);
  const sendEditor = normalizeBackupSendEditor(entry.send_editor);
  const hexFrame = normalizeHexFrameConfig(entry.hex_frame);
  const frameParser = normalizeFrameParserConfig(entry.frame_parser);
  if (!metadata || !transport || !sendEditor || !hexFrame || !frameParser
    || Number.isNaN(Date.parse(metadata.created_at))
    || Number.isNaN(Date.parse(metadata.updated_at))
    || validateFrameParserConfig(frameParser) !== null
    || !Array.isArray(entry.send_presets)
    || entry.send_presets.length > MAX_SEND_PRESETS) return null;
  const sendPresets = entry.send_presets.map(normalizeBackupSendPreset);
  if (sendPresets.some((preset) => preset === null)) return null;
  const normalizedPresets = sendPresets as SendPreset[];
  if (new Set(normalizedPresets.map((preset) => preset.id)).size !== normalizedPresets.length) return null;
  return {
    metadata,
    transport,
    send_editor: sendEditor,
    hex_frame: hexFrame,
    send_presets: normalizedPresets,
    frame_parser: frameParser,
  };
}

function normalizeBackupSendEditor(value: unknown): SendEditorDraft | null {
  if (!value || typeof value !== "object") return null;
  const editor = value as Partial<SendEditorDraft>;
  if (editor.version !== 1
    || !isBoundedString(editor.data, 0, 1_048_576)
    || (editor.format !== "text" && editor.format !== "hex")
    || (editor.text_encoding !== "utf-8" && editor.text_encoding !== "ascii" && editor.text_encoding !== "gbk")
    || (editor.line_ending !== "none" && editor.line_ending !== "cr" && editor.line_ending !== "lf" && editor.line_ending !== "crlf")
    || !isValidInterval(editor.interval_ms)) return null;
  return {
    version: 1,
    data: editor.data,
    format: editor.format,
    text_encoding: editor.text_encoding,
    line_ending: editor.line_ending,
    interval_ms: editor.interval_ms,
  };
}

function normalizeBackupTransportSettings(value: unknown): TransportSettings | null {
  if (!value || typeof value !== "object") return null;
  const settings = value as Partial<TransportSettings>;
  const serial = settings.serial as Partial<SerialConfig> | undefined;
  const tcpClient = settings.tcpClient as Partial<TcpClientConfig> | undefined;
  const tcpServer = settings.tcpServer as Partial<TcpServerConfig> | undefined;
  const udp = settings.udp as Partial<UdpConfig> | undefined;
  if (settings.version !== 1 || !isTransportMode(settings.mode)
    || !serial || serial.mode !== "serial"
    || !isBoundedString(serial.port, 0, 1_024)
    || !isIntegerInRange(serial.baudrate, 1, 50_000_000)
    || (serial.bytesize !== 5 && serial.bytesize !== 6 && serial.bytesize !== 7 && serial.bytesize !== 8)
    || (serial.parity !== "N" && serial.parity !== "E" && serial.parity !== "O" && serial.parity !== "M" && serial.parity !== "S")
    || (serial.stopbits !== 1 && serial.stopbits !== 1.5 && serial.stopbits !== 2)
    || !isIntegerInRange(serial.receive_idle_ms, 1, 1_000)
    || !tcpClient || tcpClient.mode !== "tcp_client"
    || !isBoundedString(tcpClient.host, 1, 255)
    || !isIntegerInRange(tcpClient.port, 1, 65_535)
    || !isFiniteNumber(tcpClient.connect_timeout)
    || tcpClient.connect_timeout < 0.1 || tcpClient.connect_timeout > 60
    || typeof tcpClient.auto_reconnect !== "boolean"
    || !tcpServer || tcpServer.mode !== "tcp_server"
    || !isBoundedString(tcpServer.host, 1, 255)
    || !isIntegerInRange(tcpServer.port, 0, 65_535)
    || !udp || udp.mode !== "udp"
    || !isBoundedString(udp.local_host, 1, 255)
    || !isIntegerInRange(udp.local_port, 0, 65_535)
    || !(udp.remote_host === null || isBoundedString(udp.remote_host, 1, 255))
    || !(udp.remote_port === null || isIntegerInRange(udp.remote_port, 1, 65_535))
    || ((udp.remote_host === null) !== (udp.remote_port === null))) return null;
  return {
    version: 1,
    mode: settings.mode,
    serial: {
      mode: "serial",
      port: serial.port,
      baudrate: serial.baudrate,
      bytesize: serial.bytesize,
      parity: serial.parity,
      stopbits: serial.stopbits,
      receive_idle_ms: serial.receive_idle_ms,
    },
    tcpClient: {
      mode: "tcp_client",
      host: tcpClient.host,
      port: tcpClient.port,
      connect_timeout: tcpClient.connect_timeout,
      auto_reconnect: tcpClient.auto_reconnect,
    },
    tcpServer: {
      mode: "tcp_server",
      host: tcpServer.host,
      port: tcpServer.port,
    },
    udp: {
      mode: "udp",
      local_host: udp.local_host,
      local_port: udp.local_port,
      remote_host: udp.remote_host,
      remote_port: udp.remote_port,
    },
  };
}

function normalizeConfigurationProfile(value: unknown): ConfigurationProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Partial<ConfigurationProfile>;
  if (!isBoundedString(profile.id, 1, 80)
    || !isBoundedString(profile.name, 1, 40)
    || !isBoundedString(profile.created_at, 1, 40)
    || !isBoundedString(profile.updated_at, 1, 40)) return null;
  return {
    id: profile.id,
    name: profile.name,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

function normalizeFrameParserConfig(value: unknown): FrameParserConfig | null {
  if (!value || typeof value !== "object") return null;
  const config = value as Partial<FrameParserConfig>;
  if (config.version !== 1
    || !isBoundedString(config.id, 1, 80)
    || !isBoundedString(config.name, 1, 60)
    || typeof config.enabled !== "boolean"
    || !isIntegerInRange(config.minimum_length, 0, 65_535)
    || !isIntegerInRange(config.match_offset, 0, 65_535)
    || !isBoundedString(config.match_hex, 0, 131_070)
    || !Array.isArray(config.fields)
    || config.fields.length > 32) return null;
  const fields = config.fields.map(normalizeFrameParserField);
  if (fields.some((field) => field === null)) return null;
  const normalizedFields = fields as FrameParserField[];
  if (new Set(normalizedFields.map((field) => field.id)).size !== normalizedFields.length) return null;
  return {
    version: 1,
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    minimum_length: config.minimum_length,
    match_offset: config.match_offset,
    match_hex: config.match_hex,
    fields: normalizedFields,
  };
}

function normalizeFrameParserField(value: unknown): FrameParserField | null {
  if (!value || typeof value !== "object") return null;
  const field = value as Partial<FrameParserField>;
  if (!isBoundedString(field.id, 1, 80)
    || !isBoundedString(field.name, 1, 60)
    || !isIntegerInRange(field.offset, 0, 65_535)
    || !isIntegerInRange(field.byte_length, 1, 64)
    || !isFrameParserDataType(field.data_type)
    || !isByteOrder(field.byte_order)
    || !isIntegerInRange(field.bit_index, 0, 511)
    || !isFiniteNumber(field.scale)
    || !isFiniteNumber(field.value_offset)
    || !isIntegerInRange(field.decimals, 0, 8)
    || !isBoundedString(field.unit, 0, 20)
    || typeof field.visible !== "boolean"
    || !isFrameParserDisplay(field.display)
    || !isFiniteNumber(field.minimum)
    || !isFiniteNumber(field.maximum)
    || field.minimum >= field.maximum
    || typeof field.color !== "string"
    || !/^#[0-9A-F]{6}$/i.test(field.color)) return null;
  return field as FrameParserField;
}

function isFrameParserDataType(value: unknown): value is FrameParserDataType {
  return value === "uint" || value === "int" || value === "float32" || value === "float64"
    || value === "bcd" || value === "boolean" || value === "hex" || value === "ascii";
}

function isFrameParserDisplay(value: unknown): value is FrameParserDisplay {
  return value === "number" || value === "gauge" || value === "trend" || value === "bar" || value === "status";
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
    const generator = field.generator === undefined ? undefined : normalizeFrameGenerator(field.generator);
    return (byteLength === null || isFrameByteLength(byteLength))
      && isDataSource(source)
      && isFrameDataType(dataType)
      && isBoundedString(field.value, 0, 2_097_152)
      && isByteOrder(field.byte_order)
      && generator !== null
      && (source !== "generated" || (generator !== undefined && generator !== null))
      ? {
          ...base,
          kind: field.kind,
          byte_length: byteLength,
          source,
          data_type: dataType,
          value: field.value,
          byte_order: field.byte_order,
          ...(generator ? { generator } : {}),
        }
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

function normalizeFrameGenerator(value: unknown): import("./types").HexFrameGenerator | null {
  if (!value || typeof value !== "object") return null;
  const generator = value as Record<string, unknown>;
  if (!isGeneratorControl(generator.control)
    || !isBoundedString(generator.control_name, 0, 60)
    || !isFiniteNumber(generator.minimum)
    || !isFiniteNumber(generator.maximum)
    || generator.minimum > generator.maximum
    || !isFiniteNumber(generator.step)
    || generator.step <= 0
    || !isBoundedString(generator.options, 0, 8_192)) return null;
  return {
    control: generator.control,
    control_name: generator.control_name,
    minimum: generator.minimum,
    maximum: generator.maximum,
    step: generator.step,
    options: generator.options,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePresetColumnWidth(column: PresetColumnId, value: unknown): number {
  return isFiniteNumber(value)
    ? clampPresetColumnWidth(column, value)
    : DEFAULT_LAYOUT_PREFERENCES.preset_columns[column];
}

function isDataSource(value: unknown): value is "fixed" | "editor" | "generated" {
  return value === "fixed" || value === "editor" || value === "generated";
}

function isFrameDataType(value: unknown): value is "hex" | "uint" | "int" | "float32" | "float64" | "bcd" {
  return value === "hex" || value === "uint" || value === "int" || value === "float32" || value === "float64" || value === "bcd";
}

function isGeneratorControl(value: unknown): value is import("./types").FrameGeneratorControl {
  return value === "none" || value === "uint_slider" || value === "int_slider"
    || value === "float32_slider" || value === "float64_slider"
    || value === "bit_checkboxes" || value === "bit_radio" || value === "byte_switches"
    || value === "enum" || value === "bcd_slider";
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
    && preset.id.length <= 80
    && typeof preset.name === "string"
    && preset.name.length <= 60
    && typeof preset.data === "string"
    && preset.data.length <= 1_048_576
    && (preset.format === "text" || preset.format === "hex")
    && (preset.text_encoding === "utf-8" || preset.text_encoding === "ascii" || preset.text_encoding === "gbk")
    && (preset.line_ending === "none" || preset.line_ending === "cr" || preset.line_ending === "lf" || preset.line_ending === "crlf")
    && typeof preset.updated_at === "string"
    && preset.updated_at.length <= 40;
  if (!valid) return null;
  const frameConfig = preset.frame_config === undefined ? undefined : normalizeHexFrameConfig(preset.frame_config);
  if (frameConfig === null) return null;
  return {
    id: preset.id!,
    name: preset.name!,
    data: preset.data!,
    format: preset.format!,
    text_encoding: preset.text_encoding!,
    line_ending: preset.line_ending!,
    enabled: typeof preset.enabled === "boolean" ? preset.enabled : true,
    auto_send_on_change: typeof preset.auto_send_on_change === "boolean" ? preset.auto_send_on_change : false,
    delay_ms: isValidDelay(preset.delay_ms) ? preset.delay_ms : 50,
    updated_at: preset.updated_at!,
    ...(frameConfig ? { frame_config: frameConfig } : {}),
  };
}

function normalizeBackupSendPreset(value: unknown): SendPreset | null {
  if (!value || typeof value !== "object") return null;
  const preset = value as Partial<SendPreset>;
  if (typeof preset.enabled !== "boolean"
    || typeof preset.auto_send_on_change !== "boolean"
    || !isValidDelay(preset.delay_ms)
    || !isBoundedString(preset.updated_at, 1, 40)
    || Number.isNaN(Date.parse(preset.updated_at))) return null;
  return normalizeSendPreset(value);
}

function isValidInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 86_400_000;
}

function isValidDelay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 86_400_000;
}
