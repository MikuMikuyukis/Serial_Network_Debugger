import { describe, expect, it } from "vitest";
import {
  areTransportConfigsEqual,
  buildTransportConfig,
} from "../../frontend/src/transport-config.js";
import {
  cloneTransportSettings,
  DEFAULT_TRANSPORT_SETTINGS,
} from "../../frontend/src/storage.js";

describe("frontend transport configuration", () => {
  it("规范化当前模式参数后再比较变化", () => {
    const current = cloneTransportSettings(DEFAULT_TRANSPORT_SETTINGS);
    current.mode = "tcp_client";
    const next = cloneTransportSettings(current);
    next.tcpClient.host = " 127.0.0.1 ";

    expect(areTransportConfigsEqual(
      buildTransportConfig(current),
      buildTransportConfig(next),
    )).toBe(true);

    next.tcpClient.port += 1;
    expect(areTransportConfigsEqual(
      buildTransportConfig(current),
      buildTransportConfig(next),
    )).toBe(false);
  });

  it("切换通信模式会被识别为配置变化", () => {
    const current = cloneTransportSettings(DEFAULT_TRANSPORT_SETTINGS);
    current.mode = "tcp_client";
    const next = cloneTransportSettings(current);
    next.mode = "tcp_server";

    expect(areTransportConfigsEqual(
      buildTransportConfig(current),
      buildTransportConfig(next),
    )).toBe(false);
  });

  it("把留空的 UDP 远端参数规范化为 null", () => {
    const settings = cloneTransportSettings(DEFAULT_TRANSPORT_SETTINGS);
    settings.mode = "udp";
    settings.udp.local_host = " 0.0.0.0 ";
    settings.udp.remote_host = " ";
    settings.udp.remote_port = 0;

    expect(buildTransportConfig(settings)).toEqual({
      mode: "udp",
      local_host: "0.0.0.0",
      local_port: 9000,
      remote_host: null,
      remote_port: null,
    });
  });

  it("拒绝只填写一半的 UDP 远端参数", () => {
    const settings = cloneTransportSettings(DEFAULT_TRANSPORT_SETTINGS);
    settings.mode = "udp";
    settings.udp.remote_host = "127.0.0.1";
    settings.udp.remote_port = null;

    expect(() => buildTransportConfig(settings)).toThrow("必须同时填写");
  });
});
