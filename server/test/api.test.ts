import { resolve } from "node:path";
import net from "node:net";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.js";

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
    expect(health.json()).toMatchObject({ status: "ok", version: "0.3.1" });
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
});
