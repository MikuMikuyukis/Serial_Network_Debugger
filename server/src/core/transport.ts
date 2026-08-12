import { formatData } from "./codec.js";
import type { EventBroker } from "./event-broker.js";
import type { TransportMode, TransportStatus } from "./types.js";

export class TransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransportError";
  }
}

export abstract class BaseTransport {
  abstract readonly mode: TransportMode;
  protected connected = false;
  protected rxBytes = 0;
  protected txBytes = 0;

  constructor(protected readonly broker: EventBroker) {}

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(data: Buffer): Promise<void>;

  details(): Record<string, unknown> {
    return {};
  }

  snapshot(): TransportStatus {
    return {
      connected: this.connected,
      mode: this.mode,
      rx_bytes: this.rxBytes,
      tx_bytes: this.txBytes,
      details: this.details(),
    };
  }

  protected publishStatus(): void {
    this.broker.publish({ type: "status", status: this.snapshot() });
  }

  protected publishData(direction: "rx" | "tx", data: Buffer, peer?: string): void {
    if (direction === "rx") this.rxBytes += data.length;
    else this.txBytes += data.length;
    const formatted = formatData(data);
    this.broker.publish({
      type: "data",
      direction,
      transport: this.mode,
      size: data.length,
      ...formatted,
      ...(peer ? { peer } : {}),
    });
    this.publishStatus();
  }

  protected publishError(message: string): void {
    this.broker.publish({ type: "error", transport: this.mode, message });
  }

  protected publishNotice(message: string): void {
    this.broker.publish({ type: "notice", transport: this.mode, message });
  }
}
