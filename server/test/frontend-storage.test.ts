import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIGURATION_IMPORT_EVENT_KEY,
  DEFAULT_LAYOUT_PREFERENCES,
  LAYOUT_PREFERENCES_KEY,
  cloneSendPreset,
  clampPresetColumnWidth,
  copyConfigurationProfileData,
  createConfigurationBackup,
  frameParserStorageKey,
  hexFrameStorageKey,
  importConfigurationBackup,
  loadActiveProfileId,
  loadConfigurationProfiles,
  loadHexFrameConfig,
  loadLayoutPreferences,
  loadFrameParserConfig,
  loadSendEditor,
  loadSendPresets,
  loadTransportSettings,
  parseConfigurationBackup,
  removeConfigurationProfileData,
  saveActiveProfileId,
  saveConfigurationProfiles,
  saveHexFrameConfig,
  saveLayoutPreferences,
  saveFrameParserConfig,
  saveSendEditor,
  saveSendPresets,
  saveTransportSettings,
  sendEditorStorageKey,
  sendPresetsStorageKey,
} from "../../frontend/src/storage.js";
import type { HexFrameConfig, SendPreset } from "../../frontend/src/types.js";

class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();
  #writesBeforeFailure: number | null = null;

  get length(): number { return this.#items.size; }

  clear(): void { this.#items.clear(); }

  getItem(key: string): string | null { return this.#items.get(key) ?? null; }

  key(index: number): string | null { return [...this.#items.keys()][index] ?? null; }

  removeItem(key: string): void { this.#items.delete(key); }

  setItem(key: string, value: string): void {
    if (this.#writesBeforeFailure === 0) {
      this.#writesBeforeFailure = null;
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    }
    if (this.#writesBeforeFailure !== null) this.#writesBeforeFailure -= 1;
    this.#items.set(key, value);
  }

  failWriteAfter(successfulWrites: number): void { this.#writesBeforeFailure = successfulWrites; }
}

let memoryStorage: MemoryStorage;

beforeEach(() => {
  memoryStorage = new MemoryStorage();
  vi.stubGlobal("localStorage", memoryStorage);
});

describe("frontend configuration profile storage", () => {
  it("保存界面分栏比例和发送预设列宽", () => {
    const preferences = structuredClone(DEFAULT_LAYOUT_PREFERENCES);
    preferences.tool_panel_ratio = 0.68;
    preferences.preset_columns.data = 520;
    preferences.preset_columns.name = 180;

    saveLayoutPreferences(preferences);

    expect(loadLayoutPreferences()).toEqual(preferences);
    expect(localStorage.getItem(LAYOUT_PREFERENCES_KEY)).not.toBeNull();
  });

  it("对损坏或越界的界面尺寸使用安全默认值", () => {
    localStorage.setItem(LAYOUT_PREFERENCES_KEY, JSON.stringify({
      version: 1,
      tool_panel_ratio: 9,
      preset_columns: {
        enabled: 1,
        name: "wide",
        data: 99_999,
        format: 188,
        delay: 92,
        actions: 134,
      },
    }));

    const preferences = loadLayoutPreferences();
    expect(preferences.tool_panel_ratio).toBe(DEFAULT_LAYOUT_PREFERENCES.tool_panel_ratio);
    expect(preferences.preset_columns.enabled).toBe(64);
    expect(preferences.preset_columns.name).toBe(DEFAULT_LAYOUT_PREFERENCES.preset_columns.name);
    expect(preferences.preset_columns.data).toBe(1_600);
    expect(clampPresetColumnWidth("delay", Number.NaN)).toBe(DEFAULT_LAYOUT_PREFERENCES.preset_columns.delay);

    localStorage.setItem(LAYOUT_PREFERENCES_KEY, "not-json");
    expect(loadLayoutPreferences()).toEqual(DEFAULT_LAYOUT_PREFERENCES);
  });

  it("把旧版未分组数据作为默认配置继续读取", () => {
    localStorage.setItem("snd.send-editor.v1", JSON.stringify({
      version: 1,
      data: "legacy-data",
      format: "text",
      text_encoding: "utf-8",
      line_ending: "none",
      interval_ms: 500,
    }));

    const profiles = loadConfigurationProfiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ id: "default", name: "默认配置" });
    expect(loadActiveProfileId()).toBe("default");
    expect(loadSendEditor("default").data).toBe("legacy-data");
  });

  it("按配置 ID 隔离通信参数、发送区和发送预设", () => {
    const firstSettings = loadTransportSettings("first");
    firstSettings.tcpClient.port = 9101;
    const secondSettings = loadTransportSettings("second");
    secondSettings.tcpClient.port = 9202;
    saveTransportSettings(firstSettings, "first");
    saveTransportSettings(secondSettings, "second");
    saveSendEditor({ ...loadSendEditor("first"), data: "FIRST" }, "first");
    saveSendEditor({ ...loadSendEditor("second"), data: "SECOND" }, "second");
    saveSendPresets([preset("first-preset", "A")], "first");
    saveSendPresets([preset("second-preset", "B")], "second");

    expect(loadTransportSettings("first").tcpClient.port).toBe(9101);
    expect(loadTransportSettings("second").tcpClient.port).toBe(9202);
    expect(loadSendEditor("first").data).toBe("FIRST");
    expect(loadSendEditor("second").data).toBe("SECOND");
    expect(loadSendPresets("first")[0]?.id).toBe("first-preset");
    expect(loadSendPresets("second")[0]?.id).toBe("second-preset");
  });

  it("为多窗口同步生成按配置隔离的存储键", () => {
    expect(sendPresetsStorageKey("first")).toBe("snd.profile.first.send-presets.v1");
    expect(sendEditorStorageKey("first")).toBe("snd.profile.first.send-editor.v1");
    expect(hexFrameStorageKey("first")).toBe("snd.profile.first.hex-frame-config.v1");
    expect(frameParserStorageKey("first")).toBe("snd.profile.first.frame-parser-config.v1");
    expect(frameParserStorageKey("first")).not.toBe(frameParserStorageKey("second"));
  });

  it("能够复制 Vue 响应式发送预设并断开嵌套引用", () => {
    const source = new Proxy(
      { ...preset("reactive-preset", "AA"), format: "hex" as const, frame_config: frameConfig("reactive-frame") },
      {},
    );

    expect(() => structuredClone(source)).toThrow();
    const cloned = cloneSendPreset(source);

    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(cloned.frame_config).not.toBe(source.frame_config);
    cloned.frame_config!.fields[0]!.name = "修改后的帧头";
    expect(source.frame_config.fields[0]!.name).toBe("帧头");
  });

  it("保存并恢复 Float 自定义生成控件", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "float-controls",
      enabled: true,
      fields: [{
        id: "float64",
        kind: "data",
        name: "浮点目标值",
        byte_length: 8,
        source: "generated",
        data_type: "float64",
        value: "1.5",
        byte_order: "little",
        generator: {
          control: "float64_slider",
          control_name: "浮点目标值",
          minimum: -100,
          maximum: 100,
          step: 0.1,
          options: "",
        },
      }],
    };

    saveHexFrameConfig(config, "float-profile");

    expect(loadHexFrameConfig("float-profile")).toEqual(config);
  });

  it("保存并恢复 HEX 帧中的变长字符串载荷", () => {
    const config: HexFrameConfig = {
      version: 1,
      id: "text-frame",
      enabled: true,
      fields: [{
        id: "payload",
        kind: "data",
        name: "字符串载荷",
        byte_length: null,
        source: "fixed",
        data_type: "text",
        text_encoding: "gbk",
        value: "你好",
        byte_order: "big",
      }],
    };

    saveHexFrameConfig(config, "text-profile");

    expect(loadHexFrameConfig("text-profile")).toEqual(config);
  });

  it("迁移旧 CRC16 字段并保存自定义 JS 校验", () => {
    localStorage.setItem(hexFrameStorageKey("legacy-checksum"), JSON.stringify({
      version: 1,
      id: "legacy-frame",
      enabled: true,
      fields: [{
        id: "crc",
        kind: "checksum",
        name: "CRC16-MODBUS",
        parameters: {
          preset: "modbus",
          polynomial: "8005",
          initial: "FFFF",
          xor_out: "0000",
          reflect_input: true,
          reflect_output: true,
        },
        byte_order: "little",
        range_start_id: null,
        range_end_id: null,
      }],
    }));

    expect(loadHexFrameConfig("legacy-checksum").fields[0]).toMatchObject({
      method: "crc",
      byte_length: 2,
      script: "",
      parameters: { width: 16 },
    });

    const custom = loadHexFrameConfig("legacy-checksum");
    const field = custom.fields[0]!;
    if (field.kind !== "checksum") throw new Error("预期为校验字段");
    field.method = "custom_js";
    field.byte_length = 4;
    field.script = "return bytes.reduce((sum, byte) => sum + byte, 0);";
    saveHexFrameConfig(custom, "custom-checksum");
    expect(loadHexFrameConfig("custom-checksum")).toEqual(custom);
  });

  it("复制配置时为预设和 HEX 帧生成独立标识", () => {
    const frame = frameConfig("source-frame");
    saveHexFrameConfig(frame, "source");
    saveFrameParserConfig({
      version: 1,
      id: "source-parser",
      name: "源解析",
      enabled: true,
      minimum_length: 2,
      match_offset: 0,
      match_hex: "AA 55",
      fields: [],
    }, "source");
    saveSendPresets([{ ...preset("source-preset", "AA"), format: "hex", frame_config: frame }], "source");

    copyConfigurationProfileData("source", "target");

    const sourcePreset = loadSendPresets("source")[0]!;
    const targetPreset = loadSendPresets("target")[0]!;
    expect(targetPreset.data).toBe(sourcePreset.data);
    expect(targetPreset.id).not.toBe(sourcePreset.id);
    expect(targetPreset.frame_config?.id).not.toBe(sourcePreset.frame_config?.id);
    expect(loadHexFrameConfig("target").id).not.toBe(loadHexFrameConfig("source").id);
    expect(loadFrameParserConfig("target")).toMatchObject({ name: "源解析", match_hex: "AA 55" });
    expect(loadFrameParserConfig("target").id).not.toBe(loadFrameParserConfig("source").id);
  });

  it("只恢复配置列表中仍然存在的当前配置", () => {
    loadConfigurationProfiles();
    saveActiveProfileId("missing");
    expect(loadActiveProfileId()).toBe("default");
  });

  it("删除默认配置时一并清除旧版未分组数据", () => {
    localStorage.setItem("snd.send-editor.v1", JSON.stringify({
      version: 1,
      data: "legacy-data",
      format: "text",
      text_encoding: "utf-8",
      line_ending: "none",
      interval_ms: 500,
    }));

    removeConfigurationProfileData("default");

    expect(loadSendEditor("default").data).toBe("");
    expect(loadFrameParserConfig("default").enabled).toBe(false);
  });

  it("恢复旧版解析字段时补充有序字段属性", () => {
    localStorage.setItem(frameParserStorageKey("legacy-parser"), JSON.stringify({
      version: 1,
      id: "legacy-parser",
      name: "旧版解析",
      enabled: true,
      minimum_length: 2,
      match_offset: 0,
      match_hex: "AA 55",
      fields: [{
        id: "legacy-value",
        name: "旧版数值",
        offset: 2,
        byte_length: 1,
        data_type: "uint",
        byte_order: "big",
        bit_index: 0,
        scale: 1,
        value_offset: 0,
        decimals: 0,
        unit: "",
        visible: true,
        display: "number",
        minimum: 0,
        maximum: 255,
        color: "#13A88E",
      }],
    }));

    expect(loadFrameParserConfig("legacy-parser").fields[0]).toMatchObject({
      kind: "value",
      length_mode: "fixed",
      length_field_id: null,
      match_hex: "",
      text_encoding: "utf-8",
      offset: 2,
    });
  });

  it("导出并完整恢复全部配置组的发送与接收配置", () => {
    const now = new Date(0).toISOString();
    const profiles = [
      { id: "first", name: "第一组", created_at: now, updated_at: now },
      { id: "second", name: "第二组", created_at: now, updated_at: now },
    ];
    saveConfigurationProfiles(profiles);
    saveActiveProfileId("second");
    localStorage.setItem("snd.theme", "dark");

    const firstSettings = loadTransportSettings("first");
    firstSettings.mode = "tcp_client";
    firstSettings.tcpClient.port = 9101;
    saveTransportSettings(firstSettings, "first");
    saveSendEditor({ ...loadSendEditor("first"), data: "FIRST", format: "hex" }, "first");
    const firstFrame = frameConfig("first-frame");
    saveHexFrameConfig(firstFrame, "first");
    saveSendPresets([{ ...preset("first-preset", "AA"), format: "hex", frame_config: frameConfig("preset-frame") }], "first");
    saveFrameParserConfig(parserConfig("first-parser", "AA 55"), "first");

    const secondSettings = loadTransportSettings("second");
    secondSettings.mode = "udp";
    secondSettings.udp.local_port = 9202;
    saveTransportSettings(secondSettings, "second");
    saveSendEditor({ ...loadSendEditor("second"), data: "SECOND" }, "second");
    saveHexFrameConfig(frameConfig("second-frame"), "second");
    saveSendPresets([preset("second-preset", "B")], "second");
    saveFrameParserConfig(parserConfig("second-parser", "10"), "second");

    const backup = createConfigurationBackup();
    expect(backup).toMatchObject({
      application: "serial-network-debugger",
      version: 1,
      theme: "dark",
      active_profile_id: "second",
    });
    expect(backup.profiles).toHaveLength(2);
    expect(backup.profiles[0]).toMatchObject({
      metadata: { id: "first", name: "第一组" },
      transport: { mode: "tcp_client", tcpClient: { port: 9101 } },
      send_editor: { data: "FIRST", format: "hex" },
      hex_frame: { id: "first-frame" },
      send_presets: [{ id: "first-preset", frame_config: { id: "preset-frame" } }],
      frame_parser: { id: "first-parser", match_hex: "AA 55" },
    });

    saveConfigurationProfiles([{ id: "obsolete", name: "旧配置", created_at: now, updated_at: now }]);
    saveSendEditor({ ...loadSendEditor("obsolete"), data: "OBSOLETE" }, "obsolete");
    importConfigurationBackup(parseConfigurationBackup(JSON.stringify(backup)));

    expect(loadConfigurationProfiles()).toEqual(profiles);
    expect(loadActiveProfileId()).toBe("second");
    expect(localStorage.getItem("snd.theme")).toBe("dark");
    expect(loadSendEditor("first").data).toBe("FIRST");
    expect(loadHexFrameConfig("first").id).toBe("first-frame");
    expect(loadSendPresets("first")[0]?.frame_config?.id).toBe("preset-frame");
    expect(loadFrameParserConfig("first")).toEqual(parserConfig("first-parser", "AA 55"));
    expect(loadTransportSettings("second").udp.local_port).toBe(9202);
    expect(loadSendEditor("obsolete").data).toBe("");
    expect(localStorage.getItem(CONFIGURATION_IMPORT_EVENT_KEY)).not.toBeNull();
  });

  it("拒绝损坏、未知版本或含无效嵌套配置的导入文件", () => {
    loadConfigurationProfiles();
    const backup = createConfigurationBackup();
    backup.profiles[0]!.frame_parser = parserConfig("invalid-parser", "AA");
    backup.profiles[0]!.frame_parser.fields[0]!.offset = -1;

    expect(() => parseConfigurationBackup("not-json")).toThrow("不是有效的 JSON");
    expect(() => parseConfigurationBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow("格式、版本或内容无效");
    expect(() => parseConfigurationBackup(JSON.stringify(backup))).toThrow("格式、版本或内容无效");
  });

  it("拒绝重复配置、重复预设 ID 和缺失的预设配置项", () => {
    loadConfigurationProfiles();
    const duplicateProfiles = createConfigurationBackup();
    duplicateProfiles.profiles.push(structuredClone(duplicateProfiles.profiles[0]!));

    const duplicatePresets = createConfigurationBackup();
    const duplicatePreset = preset("duplicate", "AA");
    duplicatePresets.profiles[0]!.send_presets = [duplicatePreset, structuredClone(duplicatePreset)];

    const incompletePreset = createConfigurationBackup();
    incompletePreset.profiles[0]!.send_presets = [preset("incomplete", "BB")];
    delete (incompletePreset.profiles[0]!.send_presets[0] as Partial<SendPreset>).enabled;

    expect(() => parseConfigurationBackup(JSON.stringify(duplicateProfiles))).toThrow("格式、版本或内容无效");
    expect(() => parseConfigurationBackup(JSON.stringify(duplicatePresets))).toThrow("格式、版本或内容无效");
    expect(() => parseConfigurationBackup(JSON.stringify(incompletePreset))).toThrow("格式、版本或内容无效");
  });

  it("导入写入失败时恢复原有全部配置", () => {
    loadConfigurationProfiles();
    saveSendEditor({ ...loadSendEditor(), data: "ORIGINAL" });
    const originalSettings = loadTransportSettings();
    originalSettings.tcpClient.port = 9100;
    saveTransportSettings(originalSettings);
    const incoming = createConfigurationBackup();
    incoming.profiles[0]!.send_editor.data = "IMPORTED";
    incoming.profiles[0]!.transport.tcpClient.port = 9200;

    memoryStorage.failWriteAfter(2);
    expect(() => importConfigurationBackup(incoming)).toThrow("Storage quota exceeded");
    expect(loadSendEditor().data).toBe("ORIGINAL");
    expect(loadTransportSettings().tcpClient.port).toBe(9100);
    expect(loadConfigurationProfiles()).toHaveLength(1);
    expect(localStorage.getItem(CONFIGURATION_IMPORT_EVENT_KEY)).toBeNull();
  });

  it("示例 BLE AT 指令配置可直接导入", () => {
    const serialized = readFileSync(new URL("../../examples/ble-at-command-config-v1.json", import.meta.url), "utf8");
    const backup = parseConfigurationBackup(serialized);

    expect(backup.profiles[0]?.metadata.name).toBe("BLE AT 指令");
    expect(backup.profiles[0]?.transport.serial.baudrate).toBe(115200);
    expect(backup.profiles[0]?.send_presets).toHaveLength(57);
    expect(backup.profiles[0]?.send_presets.every((preset) => (
      preset.text_encoding === "ascii" && preset.line_ending === "crlf"
    ))).toBe(true);
  });
});

function preset(id: string, data: string): SendPreset {
  return {
    id,
    name: id,
    data,
    format: "text",
    text_encoding: "utf-8",
    line_ending: "none",
    enabled: true,
    auto_send_on_change: false,
    delay_ms: 50,
    updated_at: new Date(0).toISOString(),
  };
}

function frameConfig(id: string): HexFrameConfig {
  return {
    version: 1,
    id,
    enabled: true,
    fields: [{ id: "head", kind: "header", name: "帧头", value: "AA" }],
  };
}

function parserConfig(id: string, matchHex: string) {
  return {
    version: 1 as const,
    id,
    name: id,
    enabled: true,
    minimum_length: 2,
    match_offset: 0,
    match_hex: matchHex,
    fields: [{
      id: `${id}-field`,
      name: "温度",
      kind: "value" as const,
      offset: 0,
      byte_length: 2,
      length_mode: "fixed" as const,
      length_field_id: null,
      match_hex: "",
      data_type: "uint" as const,
      text_encoding: "utf-8" as const,
      byte_order: "big" as const,
      bit_index: 0,
      scale: 0.1,
      value_offset: -40,
      decimals: 1,
      unit: "C",
      visible: true,
      display: "trend" as const,
      minimum: -40,
      maximum: 120,
      color: "#0F766E",
    }],
  };
}
