import dgram, { type RemoteInfo, type Socket } from "node:dgram";
import type { EventBroker } from "../core/event-broker.js";
import { BaseTransport, TransportError } from "../core/transport.js";
import type { UdpConfig } from "../core/types.js";

type Peer = { host: string; port: number };

export class UdpTransport extends BaseTransport {
  readonly mode = "udp" as const;
  #socket: Socket | undefined;
  #lastPeer: Peer | undefined;
  #boundHost: string;
  #boundPort: number;

  constructor(
    readonly config: UdpConfig,
    broker: EventBroker,
  ) {
    super(broker);
    this.#boundHost = config.local_host;
    this.#boundPort = config.local_port;
  }

  async start(): Promise<void> {
    const family = this.config.local_host.includes(":") ? "udp6" : "udp4";
    const socket = dgram.createSocket(family);
    this.#socket = socket;
    socket.on("message", (data, info) => this.#receive(data, info));
    socket.on("error", (error) => {
      if (this.connected) this.publishError(`UDP 通信错误：${error.message}`);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(this.config.local_port, this.config.local_host, () => {
          socket.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      this.#socket = undefined;
      try {
        socket.close();
      } catch {
        // The bind error can occur before the datagram socket starts running.
      }
      throw new TransportError(
        `无法绑定 UDP ${this.config.local_host}:${this.config.local_port}：${errorMessage(error)}`,
        { cause: error },
      );
    }
    const address = socket.address();
    this.#boundHost = address.address;
    this.#boundPort = address.port;
    this.connected = true;
    this.publishNotice(`UDP 已绑定 ${this.#boundHost}:${this.#boundPort}`);
    this.publishStatus();
  }

  async stop(): Promise<void> {
    this.connected = false;
    this.#lastPeer = undefined;
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket) {
      await new Promise<void>((resolve) => socket.close(resolve));
    }
    this.publishStatus();
  }

  async send(data: Buffer): Promise<void> {
    const socket = this.#socket;
    if (!this.connected || !socket) throw new TransportError("UDP 尚未启动");
    const target = this.fixedRemote ?? this.#lastPeer;
    if (!target) throw new TransportError("请配置 UDP 远端地址，或先接收一个数据报");
    if (data.length === 0) return;
    try {
      await new Promise<void>((resolve, reject) => {
        socket.send(data, target.port, target.host, (error) => error ? reject(error) : resolve());
      });
    } catch (error) {
      throw new TransportError(`UDP 发送失败：${errorMessage(error)}`, { cause: error });
    }
    this.publishData("tx", data, `${target.host}:${target.port}`);
  }

  override details(): Record<string, unknown> {
    const remote = this.fixedRemote ?? this.#lastPeer;
    return {
      local_host: this.#boundHost,
      local_port: this.#boundPort,
      remote: remote ? `${remote.host}:${remote.port}` : null,
      remote_source: this.fixedRemote ? "configured" : "last_sender",
    };
  }

  private get fixedRemote(): Peer | undefined {
    if (this.config.remote_host === null || this.config.remote_port === null) return undefined;
    return { host: this.config.remote_host, port: this.config.remote_port };
  }

  #receive(data: Buffer, info: RemoteInfo): void {
    this.#lastPeer = { host: info.address, port: info.port };
    this.publishData("rx", data, `${info.address}:${info.port}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
