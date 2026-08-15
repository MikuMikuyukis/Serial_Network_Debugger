import { resolve } from "node:path";
import net from "node:net";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";
import type { HexFrameConfig } from "../src/core/types.js";
import { APPLICATION_VERSION } from "../src/version.js";
import { waitForSocketData } from "./helpers.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map((app) => app.close()));
});

async function makeApp() {
  const app = await createApp({ publicDir: resolve(import.meta.dirname, "../public") });
  apps.push(app);
  return app;
}

describe("HTTP and WebSocket API", () => {
  it("提供健康状态和前端页面", async () => {
    const app = await makeApp();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", version: APPLICATION_VERSION });
    const frontend = await app.inject({ method: "GET", url: "/" });
    expect(frontend.statusCode).toBe(200);
    expect(frontend.body).toContain("Serial Network Debugger");
  });

  it("未连接时拒绝发送", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/send",
      payload: { data: "AA 55", format: "hex" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().detail).toContain("连接");
  });

  it("拒绝无效通信配置并返回前端兼容错误格式", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/connect",
      payload: { mode: "udp", local_host: "127.0.0.1", local_port: 0, remote_host: "127.0.0.1" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().detail[0].msg).toContain("UDP 远端地址和端口");
  });

  it("WebSocket 首条消息是状态快照", async () => {
    const app = await makeApp();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${address.replace("http", "ws")}/ws/events`);
    const event = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待 WebSocket 消息超时")), 2_000);
      socket.once("message", (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      });
      socket.once("error", reject);
    });
    socket.close();
    expect(event.type).toBe("status");
    expect(event.status).toMatchObject({ connected: false });
  });

  it("将真实通信数据实时转发到 WebSocket", async () => {
    const app = await makeApp();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${address.replace("http", "ws")}/ws/events`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const connected = await fetch(`${address}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "tcp_server", host: "127.0.0.1", port: 0 }),
    });
    expect(connected.status).toBe(200);
    const status = await connected.json() as { details: { port: number } };
    const dataEvent = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待实时数据事件超时")), 2_000);
      socket.on("message", (data) => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        if (event.type !== "data" || event.direction !== "rx") return;
        clearTimeout(timer);
        resolve(event);
      });
    });

    const client = net.createConnection(status.details.port, "127.0.0.1");
    await new Promise<void>((resolve) => client.once("connect", resolve));
    client.end("websocket-data");
    await expect(dataEvent).resolves.toMatchObject({
      direction: "rx",
      text: "websocket-data",
      size: 14,
    });
    socket.close();
  });

  it("启动、查询和停止周期发送，并在断开时自动停止", async () => {
    const app = await makeApp();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const connected = await fetch(`${address}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "tcp_server", host: "127.0.0.1", port: 0 }),
    });
    const status = await connected.json() as { details: { port: number } };
    const client = net.createConnection(status.details.port, "127.0.0.1");
    await new Promise<void>((resolve) => client.once("connect", resolve));
    let received = "";
    client.on("data", (data) => { received += data.toString(); });

    const started = await fetch(`${address}/api/periodic-send/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: "tick",
        format: "text",
        text_encoding: "utf-8",
        line_ending: "none",
        interval_ms: 20,
      }),
    });
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ active: true, sent_count: 1, interval_ms: 20 });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(received.length).toBeGreaterThanOrEqual(12);

    const periodic = await (await fetch(`${address}/api/periodic-send`)).json() as {
      active: boolean;
      sent_count: number;
    };
    expect(periodic.active).toBe(true);
    expect(periodic.sent_count).toBeGreaterThanOrEqual(3);

    await fetch(`${address}/api/disconnect`, { method: "POST" });
    const stopped = await (await fetch(`${address}/api/periodic-send`)).json() as {
      active: boolean;
    };
    expect(stopped.active).toBe(false);
    client.destroy();
  });

  it("连接存在时提交新配置会替换旧 transport", async () => {
    const app = await makeApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/connect",
      payload: { mode: "tcp_server", host: "127.0.0.1", port: 0 },
    });
    expect(first.statusCode, first.body).toBe(200);
    const firstPort = (first.json() as { details: { port: number } }).details.port;

    const second = await app.inject({
      method: "POST",
      url: "/api/connect",
      payload: {
        mode: "udp",
        local_host: "127.0.0.1",
        local_port: 0,
        remote_host: null,
        remote_port: null,
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ connected: true, mode: "udp" });

    await expect(new Promise<void>((resolve, reject) => {
      const client = net.createConnection(firstPort, "127.0.0.1");
      client.once("connect", () => {
        client.destroy();
        reject(new Error("旧 TCP Server 仍在监听"));
      });
      client.once("error", () => resolve());
    })).resolves.toBeUndefined();
  });

  it("HEX 帧预览等于实际发送字节，失败发送不递增序号", async () => {
    const app = await makeApp();
    const frameConfig = sequenceFrameConfig("api-manual-frame", "20");
    const payload = {
      data: "A1 B2",
      format: "hex",
      text_encoding: "utf-8",
      line_ending: "none",
      frame_config: frameConfig,
    };

    const preview = await app.inject({ method: "POST", url: "/api/frame/preview", payload: { data: payload.data, frame_config: frameConfig } });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as { hex: string };

    const connected = await app.inject({
      method: "POST",
      url: "/api/connect",
      payload: { mode: "tcp_server", host: "127.0.0.1", port: 0 },
    });
    const port = (connected.json() as { details: { port: number } }).details.port;

    const failed = await app.inject({ method: "POST", url: "/api/send", payload });
    expect(failed.statusCode).toBe(400);

    const client = net.createConnection(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });

    await waitForTcpServerClient(app);
    const firstData = waitForSocketData(client);
    const first = await app.inject({ method: "POST", url: "/api/send", payload });
    expect(first.statusCode, first.body).toBe(200);
    expect((await firstData).toString("hex").toUpperCase()).toBe(previewBody.hex.replaceAll(" ", ""));
    expect(first.json()).toMatchObject({ frame_sequences: { sequence: "21" } });

    const secondData = waitForSocketData(client);
    const second = await app.inject({ method: "POST", url: "/api/send", payload });
    expect(second.statusCode).toBe(200);
    expect((await secondData).subarray(1, 2).toString("hex").toUpperCase()).toBe("21");
    expect(second.json()).toMatchObject({ frame_sequences: { sequence: "22" } });
    client.destroy();
  });

  it("只允许回环地址执行自定义 JS 校验", async () => {
    const app = await makeApp();
    const frameConfig: HexFrameConfig = {
      version: 1,
      id: "local-custom-checksum",
      enabled: true,
      fields: [
        { id: "data", kind: "header", name: "输入", value: "01 02" },
        {
          id: "js",
          kind: "checksum",
          name: "JS",
          method: "custom_js",
          byte_length: 1,
          parameters: {
            preset: "modbus",
            width: 16,
            polynomial: "8005",
            initial: "FFFF",
            xor_out: "0000",
            reflect_input: true,
            reflect_output: true,
          },
          script: "return bytes.reduce((sum, byte) => sum + byte, 0);",
          byte_order: "big",
          range_start_id: "data",
          range_end_id: "data",
        },
      ],
    };

    const local = await app.inject({
      method: "POST",
      url: "/api/frame/preview",
      payload: { data: "", frame_config: frameConfig },
    });
    expect(local.statusCode, local.body).toBe(200);
    expect(local.json()).toMatchObject({ hex: "01 02 03" });

    const remote = await app.inject({
      method: "POST",
      url: "/api/frame/preview",
      remoteAddress: "192.168.10.20",
      payload: { data: "", frame_config: frameConfig },
    });
    expect(remote.statusCode).toBe(403);
    expect(remote.json().detail).toContain("本机回环地址");
  });

  it("周期 HEX 发送每次递增序号并公开最新序号", async () => {
    const app = await makeApp();
    const connected = await app.inject({
      method: "POST",
      url: "/api/connect",
      payload: { mode: "tcp_server", host: "127.0.0.1", port: 0 },
    });
    const port = (connected.json() as { details: { port: number } }).details.port;
    const client = net.createConnection(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    await waitForTcpServerClient(app);
    const received: number[] = [];
    client.on("data", (data) => received.push(...data));

    const started = await app.inject({
      method: "POST",
      url: "/api/periodic-send/start",
      payload: {
        data: "",
        format: "hex",
        text_encoding: "utf-8",
        line_ending: "none",
        interval_ms: 20,
        frame_config: sequenceFrameConfig("api-periodic-frame", "30", false),
      },
    });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json()).toMatchObject({ sent_count: 1, frame_sequences: { sequence: "31" } });

    await waitUntil(() => received.length >= 3);
    const status = await app.inject({ method: "GET", url: "/api/periodic-send" });
    const statusBody = status.json() as { sent_count: number; frame_sequences: Record<string, string> };
    expect(received.slice(0, 3)).toEqual([0x30, 0x31, 0x32]);
    expect(statusBody.sent_count).toBeGreaterThanOrEqual(3);
    expect(Number.parseInt(statusBody.frame_sequences.sequence!, 16)).toBeGreaterThanOrEqual(0x33);

    await app.inject({ method: "POST", url: "/api/periodic-send/stop" });
    client.destroy();
  });
});

function sequenceFrameConfig(id: string, sequence: string, includeEditorData = true): HexFrameConfig {
  return {
    version: 1,
    id,
    enabled: true,
    fields: [
      { id: "header", kind: "header", name: "帧头", value: includeEditorData ? "7E" : "" },
      { id: "sequence", kind: "sequence", name: "序号", byte_length: 1, value: sequence, step: 1, byte_order: "big" },
      ...(includeEditorData
        ? [{ id: "data", kind: "data", name: "数据", byte_length: null, source: "editor", data_type: "hex", value: "", byte_order: "big" } as const]
        : []),
    ],
  };
}

async function waitForTcpServerClient(app: Awaited<ReturnType<typeof createApp>>): Promise<void> {
  await waitUntil(async () => {
    const response = await app.inject({ method: "GET", url: "/api/status" });
    const status = response.json() as { details: { client_count?: number } };
    return (status.details.client_count ?? 0) > 0;
  });
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("等待测试条件超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
