import { SerialPort } from "serialport";
import type { EventBroker } from "../core/event-broker.js";
import { BaseTransport, TransportError } from "../core/transport.js";
import type { SerialConfig } from "../core/types.js";

const maxReceiveChunk = 65_536;

export class SerialReceiveBuffer {
  #chunks: Buffer[] = [];
  #size = 0;
  #timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly idleMs: number,
    private readonly onFlush: (data: Buffer) => void,
    private readonly maxSize = maxReceiveChunk,
  ) {}

  append(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      const available = this.maxSize - this.#size;
      const part = chunk.subarray(offset, offset + available);
      this.#chunks.push(part);
      this.#size += part.length;
      offset += part.length;
      if (this.#size === this.maxSize) this.flush();
    }
    if (this.#size > 0) {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.flush(), this.idleMs);
    }
  }

  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#size === 0) return;
    const data = Buffer.concat(this.#chunks, this.#size);
    this.#chunks = [];
    this.#size = 0;
    this.onFlush(data);
  }

  cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#chunks = [];
    this.#size = 0;
  }
}

const parityMap = {
  N: "none",
  E: "even",
  O: "odd",
  M: "mark",
  S: "space",
} as const;

export class SerialTransport extends BaseTransport {
  readonly mode = "serial" as const;
  #port: SerialPort | undefined;
  #writeQueue = Promise.resolve();
  readonly #receiveBuffer: SerialReceiveBuffer;

  constructor(
    readonly config: SerialConfig,
    broker: EventBroker,
  ) {
    super(broker);
    this.#receiveBuffer = new SerialReceiveBuffer(
      config.receive_idle_ms,
      (data) => this.publishData("rx", data),
    );
  }

  async start(): Promise<void> {
    const port = new SerialPort({
      path: this.config.port,
      baudRate: this.config.baudrate,
      dataBits: this.config.bytesize,
      parity: parityMap[this.config.parity],
      stopBits: this.config.stopbits,
      autoOpen: false,
    });
    this.#port = port;
    port.on("data", (data: Buffer) => this.#receiveBuffer.append(Buffer.from(data)));
    port.on("error", (error: Error) => {
      if (this.connected) this.publishError(`串口通信错误：${error.message}`);
    });
    port.on("close", () => {
      this.#receiveBuffer.flush();
      if (!this.connected) return;
      this.connected = false;
      this.publishNotice("串口连接已断开");
      this.publishStatus();
    });

    try {
      await new Promise<void>((resolve, reject) => {
        port.open((error) => error ? reject(error) : resolve());
      });
    } catch (error) {
      this.#port = undefined;
      throw new TransportError(
        `无法打开串口 ${this.config.port}：${errorMessage(error)}`,
        { cause: error },
      );
    }
    this.connected = true;
    this.publishNotice(`串口 ${this.config.port} 已打开`);
    this.publishStatus();
  }

  async stop(): Promise<void> {
    this.connected = false;
    this.#receiveBuffer.flush();
    const port = this.#port;
    this.#port = undefined;
    await this.#writeQueue.catch(() => undefined);
    if (port?.isOpen) {
      await new Promise<void>((resolve) => {
        port.close(() => resolve());
      });
    }
    this.publishStatus();
  }

  async send(data: Buffer): Promise<void> {
    const operation = async (): Promise<void> => {
      const port = this.#port;
      if (!this.connected || !port?.isOpen) throw new TransportError("串口尚未打开");
      if (data.length === 0) return;
      try {
        await new Promise<void>((resolve, reject) => {
          port.write(data, (error) => error ? reject(error) : resolve());
        });
        await new Promise<void>((resolve, reject) => {
          port.drain((error) => error ? reject(error) : resolve());
        });
      } catch (error) {
        throw new TransportError(`串口发送失败：${errorMessage(error)}`, { cause: error });
      }
      this.publishData("tx", data);
    };
    const result = this.#writeQueue.then(operation, operation);
    this.#writeQueue = result.catch(() => undefined);
    await result;
  }

  override details(): Record<string, unknown> {
    return {
      port: this.config.port,
      baudrate: this.config.baudrate,
      bytesize: this.config.bytesize,
      parity: this.config.parity,
      stopbits: this.config.stopbits,
      receive_idle_ms: this.config.receive_idle_ms,
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
