import type { ServerEvent } from "./types.js";

export type EventListener = (event: ServerEvent) => void;

export class EventBroker {
  readonly #listeners = new Set<EventListener>();

  publish(event: ServerEvent): void {
    const message = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    } satisfies ServerEvent;
    for (const listener of [...this.#listeners]) listener(message);
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
