from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from comm_debugger.codec import format_data
from comm_debugger.events import EventBroker


class TransportError(RuntimeError):
    pass


class BaseTransport(ABC):
    mode: str

    def __init__(self, broker: EventBroker) -> None:
        self.broker = broker
        self.connected = False
        self.rx_bytes = 0
        self.tx_bytes = 0

    @abstractmethod
    async def start(self) -> None:
        pass

    @abstractmethod
    async def stop(self) -> None:
        pass

    @abstractmethod
    async def send(self, data: bytes) -> None:
        pass

    def details(self) -> dict[str, Any]:
        return {}

    def snapshot(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "mode": self.mode,
            "rx_bytes": self.rx_bytes,
            "tx_bytes": self.tx_bytes,
            "details": self.details(),
        }

    def publish_status(self) -> None:
        self.broker.publish({"type": "status", "status": self.snapshot()})

    def publish_data(self, direction: str, data: bytes, peer: str | None = None) -> None:
        if direction == "rx":
            self.rx_bytes += len(data)
        else:
            self.tx_bytes += len(data)
        hex_value, text_value = format_data(data)
        event: dict[str, Any] = {
            "type": "data",
            "direction": direction,
            "transport": self.mode,
            "size": len(data),
            "hex": hex_value,
            "text": text_value,
        }
        if peer:
            event["peer"] = peer
        self.broker.publish(event)
        self.publish_status()

    def publish_error(self, message: str) -> None:
        self.broker.publish(
            {
                "type": "error",
                "transport": self.mode,
                "message": message,
            }
        )

    def publish_notice(self, message: str) -> None:
        self.broker.publish(
            {
                "type": "notice",
                "transport": self.mode,
                "message": message,
            }
        )
