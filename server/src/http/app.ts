import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { SerialPort } from "serialport";
import { ZodError } from "zod";
import { encodePayload } from "../core/codec.js";
import { EventBroker } from "../core/event-broker.js";
import { PeriodicSender } from "../core/periodic-sender.js";
import {
  periodicSendRequestSchema,
  sendRequestSchema,
  transportConfigSchema,
} from "../core/schemas.js";
import { TransportError } from "../core/transport.js";
import { TransportManager } from "../core/transport-manager.js";

export interface AppOptions {
  logger?: boolean;
  publicDir?: string;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const broker = new EventBroker();
  const manager = new TransportManager(broker);
  const periodicSender = new PeriodicSender(manager, broker);
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const publicDir = options.publicDir ?? resolve(moduleDir, "../../public");

  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/static/",
    decorateReply: true,
  });

  app.get("/", async (_request, reply) => reply.sendFile("index.html"));
  app.get("/favicon.ico", async (_request, reply) => reply.status(204).send());

  app.get("/api/health", async () => ({ status: "ok", version: "0.3.1" }));
  app.get("/api/status", async () => manager.snapshot());
  app.get("/api/periodic-send", async () => periodicSender.snapshot());

  app.get("/api/serial/ports", async () => {
    const ports = await SerialPort.list();
    return ports
      .map((port) => {
        const extended = port as typeof port & { friendlyName?: string };
        return {
          device: port.path,
          description: extended.friendlyName ?? port.manufacturer ?? null,
          manufacturer: port.manufacturer ?? null,
          hwid: port.pnpId ?? null,
        };
      })
      .sort((left, right) => left.device.localeCompare(right.device, undefined, { numeric: true }));
  });

  app.post("/api/connect", async (request, reply) => {
    try {
      periodicSender.stop();
      const config = transportConfigSchema.parse(request.body);
      return await manager.connect(config);
    } catch (error) {
      return sendRequestError(reply, error, broker);
    }
  });

  app.post("/api/disconnect", async () => {
    periodicSender.stop();
    await manager.disconnect();
    return { ok: true, message: "通信连接已关闭" };
  });

  app.post("/api/send", async (request, reply) => {
    try {
      const body = sendRequestSchema.parse(request.body);
      const payload = encodePayload(body.data, body.format, body.text_encoding, body.line_ending);
      if (payload.length === 0) throw new Error("发送内容不能为空");
      await manager.send(payload);
      return { ok: true, message: `已发送 ${payload.length} 字节` };
    } catch (error) {
      return sendRequestError(reply, error, broker);
    }
  });

  app.post("/api/periodic-send/start", async (request, reply) => {
    try {
      const body = periodicSendRequestSchema.parse(request.body);
      const payload = encodePayload(body.data, body.format, body.text_encoding, body.line_ending);
      if (payload.length === 0) throw new Error("周期发送内容不能为空");
      return await periodicSender.start(payload, body.interval_ms);
    } catch (error) {
      return sendRequestError(reply, error, broker);
    }
  });

  app.post("/api/periodic-send/stop", async () => ({
    ok: true,
    message: "周期发送已停止",
    status: periodicSender.stop(),
  }));

  app.get("/ws/events", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "status", status: manager.snapshot() }));
    socket.send(JSON.stringify({ type: "periodic_status", status: periodicSender.snapshot() }));
    const unsubscribe = broker.subscribe((event) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    });
    const pingTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "ping", timestamp: new Date().toISOString() }));
      }
    }, 20_000);
    socket.once("close", () => {
      clearInterval(pingTimer);
      unsubscribe();
    });
  });

  app.addHook("onClose", async () => {
    periodicSender.stop();
    await manager.disconnect();
  });
  return app;
}

function sendRequestError(
  reply: FastifyReply,
  error: unknown,
  broker: EventBroker,
): unknown {
  if (error instanceof ZodError) {
    return reply.status(422).send({
      detail: error.issues.map((issue) => ({ msg: issue.message, loc: issue.path })),
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TransportError || error instanceof Error) {
    broker.publish({ type: "error", message });
    return reply.status(400).send({ detail: message });
  }
  throw error;
}
