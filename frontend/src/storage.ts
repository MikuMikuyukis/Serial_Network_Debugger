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

const SETTINGS_KEY = "snd.transport-settings.v1";
const THEME_KEY = "snd.theme";
const SEND_PRESETS_KEY = "snd.send-presets.v1";
const SEND_EDITOR_KEY = "snd.send-editor.v1";
const HEX_FRAME_CONFIG_KEY = "snd.hex-frame-config.v1";
export const FRAME_PARSER_CONFIG_KEY = "snd.frame-parser-config.v1";
const PROFILES_KEY = "snd.configuration-profiles.v1";
const ACTIVE_PROFILE_KEY = "snd.active-configuration-profile.v1";
const DEFAULT_PROFILE_ID = "default";
export const MAX_CONFIGURATION_PROFILES = 20;
export const MAX_SEND_PRESETS = 100;

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

function isDataSource(value: unknown): value is "fixed" | "editor" | "generated" {
  return value === "fixed" || value === "editor" || value === "generated";
}

function isFrameDataType(value: unknown): value is "hex" | "uint" | "int" | "float32" | "float64" | "bcd" {
  return value === "hex" || value === "uint" || value === "int" || value === "float32" || value === "float64" || value === "bcd";
}

function isGeneratorControl(value: unknown): value is import("./types").FrameGeneratorControl {
  return value === "none" || value === "uint_slider" || value === "int_slider"
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
    auto_send_on_change: typeof preset.auto_send_on_change === "boolean" ? preset.auto_send_on_change : false,
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
