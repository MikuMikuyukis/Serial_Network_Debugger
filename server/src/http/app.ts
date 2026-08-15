import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { SerialPort } from "serialport";
import { ZodError } from "zod";
import { encodePayload } from "../core/codec.js";
import { buildHexFrame, containsCustomChecksum, HexFrameSession } from "../core/hex-frame.js";
import { EventBroker } from "../core/event-broker.js";
import { PeriodicSender } from "../core/periodic-sender.js";
import { APPLICATION_VERSION } from "../version.js";
import {
  periodicSendRequestSchema,
  sendRequestSchema,
  transportConfigSchema,
  hexFramePreviewSchema,
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
  const frameSession = new HexFrameSession();
  const periodicSender = new PeriodicSender(manager, broker, frameSession);
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

  app.get("/api/health", async () => ({ status: "ok", version: APPLICATION_VERSION }));
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
      const frameConfig = body.format === "hex" && body.frame_config?.enabled
        ? body.frame_config
        : undefined;
      assertCustomChecksumAllowed(request.ip, frameConfig);
      const frame = frameConfig
        ? await frameSession.send(frameConfig, body.data, (data) => manager.send(data))
        : null;
      const payload = frame?.data ?? encodePayload(body.data, body.format, body.text_encoding, body.line_ending);
      if (!frame) {
        if (payload.length === 0) throw new Error("发送内容不能为空");
        await manager.send(payload);
      }
      return {
        ok: true,
        message: `已发送 ${payload.length} 字节`,
        frame_sequences: frame?.nextSequences ?? null,
      };
    } catch (error) {
      return sendRequestError(reply, error, broker);
    }
  });

  app.post("/api/frame/preview", async (request, reply) => {
    try {
      const body = hexFramePreviewSchema.parse(request.body);
      assertCustomChecksumAllowed(request.ip, body.frame_config);
      const frame = buildHexFrame(body.frame_config, body.data);
      return {
        hex: frame.data.toString("hex").toUpperCase().replaceAll(/(..)(?=.)/g, "$1 "),
        size: frame.data.length,
        next_sequences: frame.nextSequences,
      };
    } catch (error) {
      return sendRequestError(reply, error, broker);
    }
  });

  app.post("/api/periodic-send/start", async (request, reply) => {
    try {
      const body = periodicSendRequestSchema.parse(request.body);
      const frameConfig = body.format === "hex" && body.frame_config?.enabled
        ? body.frame_config
        : undefined;
      assertCustomChecksumAllowed(request.ip, frameConfig);
      const initialFrame = frameConfig ? frameSession.preview(frameConfig, body.data).data : null;
      const payload = frameConfig
        ? Buffer.alloc(0)
        : encodePayload(body.data, body.format, body.text_encoding, body.line_ending);
      if ((initialFrame?.length ?? payload.length) === 0) throw new Error("周期发送内容不能为空");
      return await periodicSender.start(
        payload,
        body.interval_ms,
        frameConfig ? { config: frameConfig, editorData: body.data } : undefined,
      );
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
  if (error instanceof CustomChecksumAccessError) {
    broker.publish({ type: "error", message: error.message });
    return reply.status(403).send({ detail: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TransportError || error instanceof Error) {
    broker.publish({ type: "error", message });
    return reply.status(400).send({ detail: message });
  }
  throw error;
}

class CustomChecksumAccessError extends Error {}

function assertCustomChecksumAllowed(address: string, config: Parameters<typeof containsCustomChecksum>[0]): void {
  if (!containsCustomChecksum(config) || isLoopbackAddress(address)) return;
  throw new CustomChecksumAccessError("自定义 JS 校验仅允许从本机回环地址使用");
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "::1"
    || normalized === "0:0:0:0:0:0:0:1"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
    || /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized);
}
