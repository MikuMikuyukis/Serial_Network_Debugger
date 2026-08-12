import type { EventBroker } from "./event-broker.js";
import { TransportError, type BaseTransport } from "./transport.js";
import type { TransportConfig, TransportStatus } from "./types.js";
import { SerialTransport } from "../transports/serial.js";
import { TcpClientTransport, TcpServerTransport } from "../transports/tcp.js";
import { UdpTransport } from "../transports/udp.js";

const emptyStatus = (): TransportStatus => ({
  connected: false,
  mode: null,
  rx_bytes: 0,
  tx_bytes: 0,
  details: {},
});

export class TransportManager {
  #transport: BaseTransport | undefined;
  #operation = Promise.resolve();

  constructor(readonly broker: EventBroker) {}

  snapshot(): TransportStatus {
    return this.#transport?.snapshot() ?? emptyStatus();
  }

  connect(config: TransportConfig): Promise<TransportStatus> {
    return this.#exclusive(async () => {
      await this.#disconnectUnlocked();
      const transport = this.#createTransport(config);
      this.#transport = transport;
      try {
        await transport.start();
      } catch (error) {
        this.#transport = undefined;
        throw error;
      }
      return transport.snapshot();
    });
  }

  disconnect(): Promise<void> {
    return this.#exclusive(() => this.#disconnectUnlocked());
  }

  async send(data: Buffer): Promise<void> {
    const transport = this.#transport;
    if (!transport) throw new TransportError("请先建立通信连接");
    await transport.send(data);
  }

  async #disconnectUnlocked(): Promise<void> {
    const transport = this.#transport;
    this.#transport = undefined;
    if (transport) {
      await transport.stop();
      this.broker.publish({
        type: "notice",
        transport: transport.mode,
        message: "通信连接已关闭",
      });
    }
    this.broker.publish({ type: "status", status: emptyStatus() });
  }

  #createTransport(config: TransportConfig): BaseTransport {
    switch (config.mode) {
      case "serial": return new SerialTransport(config, this.broker);
      case "tcp_client": return new TcpClientTransport(config, this.broker);
      case "tcp_server": return new TcpServerTransport(config, this.broker);
      case "udp": return new UdpTransport(config, this.broker);
    }
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operation;
    let release: () => void = () => undefined;
    this.#operation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
