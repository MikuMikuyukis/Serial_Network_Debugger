from __future__ import annotations

import asyncio
from typing import Any

from comm_debugger.events import EventBroker
from comm_debugger.models import (
    SerialConfig,
    TcpClientConfig,
    TcpServerConfig,
    TransportConfig,
    UdpConfig,
)
from comm_debugger.transports import (
    BaseTransport,
    SerialTransport,
    TcpClientTransport,
    TcpServerTransport,
    TransportError,
    UdpTransport,
)


class TransportManager:
    def __init__(self, broker: EventBroker) -> None:
        self.broker = broker
        self._transport: BaseTransport | None = None
        self._operation_lock = asyncio.Lock()

    def snapshot(self) -> dict[str, Any]:
        if self._transport is None:
            return {
                "connected": False,
                "mode": None,
                "rx_bytes": 0,
                "tx_bytes": 0,
                "details": {},
            }
        return self._transport.snapshot()

    async def connect(self, config: TransportConfig) -> dict[str, Any]:
        async with self._operation_lock:
            await self._disconnect_unlocked()
            transport = self._create_transport(config)
            self._transport = transport
            try:
                await transport.start()
            except Exception:
                self._transport = None
                raise
            return transport.snapshot()

    async def disconnect(self) -> None:
        async with self._operation_lock:
            await self._disconnect_unlocked()

    async def send(self, data: bytes) -> None:
        transport = self._transport
        if transport is None:
            raise TransportError("请先建立通信连接")
        await transport.send(data)

    async def _disconnect_unlocked(self) -> None:
        transport, self._transport = self._transport, None
        if transport is not None:
            await transport.stop()
            self.broker.publish(
                {
                    "type": "notice",
                    "transport": transport.mode,
                    "message": "通信连接已关闭",
                }
            )
        self.broker.publish({"type": "status", "status": self.snapshot()})

    def _create_transport(self, config: TransportConfig) -> BaseTransport:
        if isinstance(config, SerialConfig):
            return SerialTransport(config, self.broker)
        if isinstance(config, TcpClientConfig):
            return TcpClientTransport(config, self.broker)
        if isinstance(config, TcpServerConfig):
            return TcpServerTransport(config, self.broker)
        if isinstance(config, UdpConfig):
            return UdpTransport(config, self.broker)
        raise TransportError("不支持的通信模式")
