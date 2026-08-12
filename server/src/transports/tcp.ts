import net, { type Server, type Socket } from "node:net";
import type { EventBroker } from "../core/event-broker.js";
import { BaseTransport, TransportError } from "../core/transport.js";
import type { TcpClientConfig, TcpServerConfig } from "../core/types.js";

function peerName(socket: Socket): string {
  return `${socket.remoteAddress ?? "未知客户端"}:${socket.remotePort ?? "?"}`;
}

export class TcpClientTransport extends BaseTransport {
  readonly mode = "tcp_client" as const;
  #socket: Socket | undefined;

  constructor(
    readonly config: TcpClientConfig,
    broker: EventBroker,
  ) {
    super(broker);
  }

  async start(): Promise<void> {
    const socket = new net.Socket();
    this.#socket = socket;
    socket.setNoDelay(true);
    socket.on("data", (data) => this.publishData("rx", data, this.peer));
    socket.on("error", (error) => {
      if (this.connected) this.publishError(`TCP 连接错误：${error.message}`);
    });
    socket.on("close", () => {
      if (!this.connected) return;
      this.connected = false;
      this.publishNotice("TCP 远端已断开");
      this.publishStatus();
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.destroy();
          reject(new Error("连接超时"));
        }, this.config.connect_timeout * 1_000);
        const onError = (error: Error): void => {
          clearTimeout(timeout);
          reject(error);
        };
        socket.once("error", onError);
        socket.connect(this.config.port, this.config.host, () => {
          clearTimeout(timeout);
          socket.off("error", onError);
          resolve();
        });
      });
    } catch (error) {
      this.#socket = undefined;
      socket.destroy();
      throw new TransportError(
        `无法连接 TCP ${this.peer}：${errorMessage(error)}`,
        { cause: error },
      );
    }
    this.connected = true;
    this.publishNotice(`已连接 TCP ${this.peer}`);
    this.publishStatus();
  }

  async stop(): Promise<void> {
    this.connected = false;
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket && !socket.destroyed) {
      await new Promise<void>((resolve) => {
        socket.once("close", resolve);
        socket.destroy();
      });
    }
    this.publishStatus();
  }

  async send(data: Buffer): Promise<void> {
    const socket = this.#socket;
    if (!this.connected || !socket || socket.destroyed) {
      throw new TransportError("TCP Client 尚未连接");
    }
    if (data.length === 0) return;
    try {
      await new Promise<void>((resolve, reject) => {
        socket.write(data, (error) => error ? reject(error) : resolve());
      });
    } catch (error) {
      throw new TransportError(`TCP 发送失败：${errorMessage(error)}`, { cause: error });
    }
    this.publishData("tx", data, this.peer);
  }

  override details(): Record<string, unknown> {
    return { host: this.config.host, port: this.config.port };
  }

  private get peer(): string {
    return `${this.config.host}:${this.config.port}`;
  }
}

export class TcpServerTransport extends BaseTransport {
  readonly mode = "tcp_server" as const;
  #server: Server | undefined;
  readonly #clients = new Set<Socket>();
  #boundHost: string;
  #boundPort: number;

  constructor(
    readonly config: TcpServerConfig,
    broker: EventBroker,
  ) {
    super(broker);
    this.#boundHost = config.host;
    this.#boundPort = config.port;
  }

  async start(): Promise<void> {
    const server = net.createServer((socket) => this.#acceptClient(socket));
    this.#server = server;
    server.on("error", (error) => {
      if (this.connected) this.publishError(`TCP Server 监听错误：${error.message}`);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.config.port, this.config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      this.#server = undefined;
      throw new TransportError(
        `无法监听 TCP ${this.config.host}:${this.config.port}：${errorMessage(error)}`,
        { cause: error },
      );
    }
    const address = server.address();
    if (address && typeof address !== "string") {
      this.#boundHost = address.address;
      this.#boundPort = address.port;
    }
    this.connected = true;
    this.publishNotice(`TCP Server 正在监听 ${this.#boundHost}:${this.#boundPort}`);
    this.publishStatus();
  }

  async stop(): Promise<void> {
    this.connected = false;
    for (const socket of this.#clients) socket.destroy();
    this.#clients.clear();
    const server = this.#server;
    this.#server = undefined;
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.publishStatus();
  }

  async send(data: Buffer): Promise<void> {
    if (!this.connected) throw new TransportError("TCP Server 尚未启动");
    const clients = [...this.#clients].filter((socket) => !socket.destroyed);
    if (clients.length === 0) throw new TransportError("当前没有 TCP 客户端连接");
    if (data.length === 0) return;
    const results = await Promise.allSettled(clients.map((socket) => new Promise<void>((resolve, reject) => {
      socket.write(data, (error) => error ? reject(error) : resolve());
    })));
    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    results.forEach((result, index) => {
      if (result.status === "rejected") clients[index]?.destroy();
    });
    if (succeeded === 0) throw new TransportError("向所有 TCP 客户端发送均失败");
    this.publishData("tx", data, `广播至 ${succeeded} 个客户端`);
  }

  override details(): Record<string, unknown> {
    return {
      host: this.#boundHost,
      port: this.#boundPort,
      client_count: this.#clients.size,
      clients: [...this.#clients].map(peerName),
    };
  }

  #acceptClient(socket: Socket): void {
    socket.setNoDelay(true);
    this.#clients.add(socket);
    const peer = peerName(socket);
    this.publishNotice(`TCP 客户端已连接：${peer}`);
    this.publishStatus();
    socket.on("data", (data) => this.publishData("rx", data, peer));
    socket.on("error", (error) => {
      if (this.connected) this.publishError(`TCP 客户端 ${peer} 通信错误：${error.message}`);
    });
    socket.on("close", () => {
      if (!this.#clients.delete(socket)) return;
      if (this.connected) {
        this.publishNotice(`TCP 客户端已断开：${peer}`);
        this.publishStatus();
      }
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
