import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  desktopUserDataPath,
  isLoopbackHost,
  parseDesktopOptions,
} from "../../desktop/src/options.js";

describe("Electron desktop instance options", () => {
  it("默认使用现有配置目录和自动 Web 端口", () => {
    expect(parseDesktopOptions([])).toEqual({
      instanceId: "default",
      webHost: "127.0.0.1",
      webPort: 0,
      help: false,
    });
    expect(desktopUserDataPath("/tmp/snd", "default")).toBe("/tmp/snd");
  });

  it("为命名实例生成独立目录并接受固定 Web 监听参数", () => {
    expect(parseDesktopOptions([
      "--instance", "device-a",
      "--web-host=0.0.0.0",
      "--web-port", "8871",
    ])).toEqual({
      instanceId: "device-a",
      webHost: "0.0.0.0",
      webPort: 8871,
      help: false,
    });
    expect(desktopUserDataPath("/tmp/snd", "device-a")).toBe(join("/tmp/snd", "instances", "device-a"));
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("拒绝不安全实例名、无效端口和未知参数", () => {
    expect(() => parseDesktopOptions(["--instance", "../shared"])).toThrow("--instance");
    expect(() => parseDesktopOptions(["--web-port", "70000"])).toThrow("--web-port");
    expect(() => parseDesktopOptions(["--unknown"])).toThrow("未知参数");
  });
});
