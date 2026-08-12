import type { EventBroker } from "./event-broker.js";
import type { PeriodicSendStatus } from "./types.js";

export interface SendTarget {
  send(data: Buffer): Promise<void>;
}

const emptyStatus = (): PeriodicSendStatus => ({
  active: false,
  interval_ms: null,
  sent_count: 0,
  started_at: null,
  last_sent_at: null,
});

export class PeriodicSender {
  #status = emptyStatus();
  #timer: NodeJS.Timeout | undefined;
  #generation = 0;

  constructor(
    private readonly target: SendTarget,
    private readonly broker: EventBroker,
  ) {}

  snapshot(): PeriodicSendStatus {
    return { ...this.#status };
  }

  async start(data: Buffer, intervalMs: number): Promise<PeriodicSendStatus> {
    this.stop();
    const generation = this.#generation;
    this.#status = {
      active: true,
      interval_ms: intervalMs,
      sent_count: 0,
      started_at: new Date().toISOString(),
      last_sent_at: null,
    };
    this.#publishStatus();
    try {
      await this.#sendOnce(data, generation, false);
    } catch (error) {
      this.#stopGeneration(generation);
      throw error;
    }
    return this.snapshot();
  }

  stop(): PeriodicSendStatus {
    this.#generation += 1;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const wasActive = this.#status.active;
    this.#status = emptyStatus();
    if (wasActive) this.#publishStatus();
    return this.snapshot();
  }

  async #sendOnce(data: Buffer, generation: number, publishFailure = true): Promise<void> {
    if (!this.#isCurrent(generation)) return;
    try {
      await this.target.send(data);
    } catch (error) {
      if (this.#isCurrent(generation)) {
        this.#stopGeneration(generation);
        if (publishFailure) {
          const message = error instanceof Error ? error.message : String(error);
          this.broker.publish({ type: "error", message: `周期发送已停止：${message}` });
        }
      }
      throw error;
    }
    if (!this.#isCurrent(generation)) return;
    this.#status.sent_count += 1;
    this.#status.last_sent_at = new Date().toISOString();
    this.#publishStatus();
    this.#timer = setTimeout(
      () => void this.#sendOnce(data, generation).catch(() => undefined),
      this.#status.interval_ms!,
    );
  }

  #stopGeneration(generation: number): void {
    if (!this.#isCurrent(generation)) return;
    this.#generation += 1;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#status = emptyStatus();
    this.#publishStatus();
  }

  #isCurrent(generation: number): boolean {
    return generation === this.#generation && this.#status.active;
  }

  #publishStatus(): void {
    this.broker.publish({ type: "periodic_status", status: this.snapshot() });
  }
}
