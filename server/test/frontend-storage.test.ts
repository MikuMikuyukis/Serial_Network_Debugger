import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyConfigurationProfileData,
  frameParserStorageKey,
  hexFrameStorageKey,
  loadActiveProfileId,
  loadConfigurationProfiles,
  loadHexFrameConfig,
  loadFrameParserConfig,
  loadSendEditor,
  loadSendPresets,
  loadTransportSettings,
  removeConfigurationProfileData,
  saveActiveProfileId,
  saveHexFrameConfig,
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

  get length(): number { return this.#items.size; }

  clear(): void { this.#items.clear(); }

  getItem(key: string): string | null { return this.#items.get(key) ?? null; }

  key(index: number): string | null { return [...this.#items.keys()][index] ?? null; }

  removeItem(key: string): void { this.#items.delete(key); }

  setItem(key: string, value: string): void { this.#items.set(key, value); }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

describe("frontend configuration profile storage", () => {
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
