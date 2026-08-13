import net, { type Server, type Socket } from "node:net";
import type { EventBroker } from "../core/event-broker.js";
import { BaseTransport, TransportError } from "../core/transport.js";
import type { TcpClientConfig, TcpServerConfig } from "../core/types.js";

function peerName(socket: Socket): string {
  return `${socket.remoteAddress ?? "未知客户端"}:${socket.remotePort ?? "?"}`;
}

const TCP_RECONNECT_INTERVAL_MS = 3_000;

export class TcpClientTransport extends BaseTransport {
  readonly mode = "tcp_client" as const;
  #socket: Socket | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #reconnecting = false;
  #stopping = true;
  #generation = 0;

  constructor(
    readonly config: TcpClientConfig,
    broker: EventBroker,
  ) {
    super(broker);
  }

  async start(): Promise<void> {
    this.#stopping = false;
    this.#generation += 1;
    try {
      await this.#connect(false, this.#generation);
    } catch (error) {
      this.#stopping = true;
      throw new TransportError(
        `无法连接 TCP ${this.peer}：${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  async #connect(reconnecting: boolean, generation: number): Promise<void> {
    const socket = new net.Socket();
    this.#socket = socket;
    socket.setNoDelay(true);

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
      if (this.#socket === socket) this.#socket = undefined;
      socket.destroy();
      throw error;
    }

    if (this.#stopping || generation !== this.#generation) {
      if (this.#socket === socket) this.#socket = undefined;
      socket.destroy();
      return;
    }

    socket.on("data", (data) => this.publishData("rx", data, this.peer));
    socket.on("error", (error) => {
      if (this.connected && this.#socket === socket) {
        this.publishError(`TCP 连接错误：${error.message}`);
      }
    });
    socket.on("close", () => this.#handleClose(socket));
    this.connected = true;
    this.#reconnecting = false;
    this.publishNotice(`${reconnecting ? "已重新连接" : "已连接"} TCP ${this.peer}`);
    this.publishStatus();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#generation += 1;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#reconnecting = false;
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
    return {
      host: this.config.host,
      port: this.config.port,
      auto_reconnect: this.config.auto_reconnect,
      reconnecting: this.#reconnecting,
      reconnect_interval_ms: TCP_RECONNECT_INTERVAL_MS,
    };
  }

  private get peer(): string {
    return `${this.config.host}:${this.config.port}`;
  }

  #handleClose(socket: Socket): void {
    if (this.#socket !== socket) return;
    this.#socket = undefined;
    if (this.#stopping) return;
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) this.publishNotice("TCP 远端已断开");
    if (this.config.auto_reconnect) {
      this.#scheduleReconnect();
    } else {
      this.publishStatus();
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopping || this.connected || this.#reconnectTimer) return;
    const wasReconnecting = this.#reconnecting;
    this.#reconnecting = true;
    if (!wasReconnecting) {
      this.publishNotice(`将在 ${TCP_RECONNECT_INTERVAL_MS / 1_000} 秒后重连 TCP ${this.peer}`);
      this.publishStatus();
    }
    const generation = this.#generation;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#retryConnect(generation);
    }, TCP_RECONNECT_INTERVAL_MS);
  }

  async #retryConnect(generation: number): Promise<void> {
    if (this.#stopping || generation !== this.#generation) return;
    this.publishNotice(`正在重连 TCP ${this.peer}`);
    try {
      await this.#connect(true, generation);
    } catch (error) {
      if (this.#stopping || generation !== this.#generation) return;
      this.publishNotice(`TCP 重连失败：${errorMessage(error)}`);
      this.#scheduleReconnect();
    }
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
