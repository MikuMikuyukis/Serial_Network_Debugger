from __future__ import annotations

import asyncio
from typing import Any

from comm_debugger.events import EventBroker
from comm_debugger.models import UdpConfig
from comm_debugger.transports.base import BaseTransport, TransportError


class _UdpProtocol(asyncio.DatagramProtocol):
    def __init__(self, owner: "UdpTransport") -> None:
        self.owner = owner

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        self.owner.receive_datagram(data, addr)

    def error_received(self, exc: Exception) -> None:
        self.owner.publish_error(f"UDP 通信错误：{exc}")

    def connection_lost(self, exc: Exception | None) -> None:
        if exc is not None and self.owner.connected:
            self.owner.publish_error(f"UDP 端点已关闭：{exc}")


class UdpTransport(BaseTransport):
    mode = "udp"

    def __init__(self, config: UdpConfig, broker: EventBroker) -> None:
        super().__init__(broker)
        self.config = config
        self._transport: asyncio.DatagramTransport | None = None
        self._last_peer: tuple[str, int] | None = None
        self._bound_host = config.local_host
        self._bound_port = config.local_port

    async def start(self) -> None:
        loop = asyncio.get_running_loop()
        try:
            transport, _ = await loop.create_datagram_endpoint(
                lambda: _UdpProtocol(self),
                local_addr=(self.config.local_host, self.config.local_port),
            )
        except OSError as exc:
            raise TransportError(
                f"无法绑定 UDP {self.config.local_host}:{self.config.local_port}：{exc}"
            ) from exc
        self._transport = transport
        address = transport.get_extra_info("sockname")
        if isinstance(address, tuple) and len(address) >= 2:
            self._bound_host = str(address[0])
            self._bound_port = int(address[1])
        self.connected = True
        self.publish_notice(f"UDP 已绑定 {self._bound_host}:{self._bound_port}")
        self.publish_status()

    async def stop(self) -> None:
        self.connected = False
        transport, self._transport = self._transport, None
        self._last_peer = None
        if transport is not None:
            transport.close()
            await asyncio.sleep(0)
        self.publish_status()

    async def send(self, data: bytes) -> None:
        if not self.connected or self._transport is None:
            raise TransportError("UDP 尚未启动")
        target = self.fixed_remote or self._last_peer
        if target is None:
            raise TransportError("请配置 UDP 远端地址，或先接收一个数据报")
        if not data:
            return
        try:
            self._transport.sendto(data, target)
        except (OSError, ValueError) as exc:
            raise TransportError(f"UDP 发送失败：{exc}") from exc
        self.publish_data("tx", data, f"{target[0]}:{target[1]}")

    @property
    def fixed_remote(self) -> tuple[str, int] | None:
        if self.config.remote_host is None or self.config.remote_port is None:
            return None
        return self.config.remote_host, self.config.remote_port

    def receive_datagram(self, data: bytes, addr: tuple[str, int]) -> None:
        self._last_peer = addr
        self.publish_data("rx", data, f"{addr[0]}:{addr[1]}")

    def details(self) -> dict[str, Any]:
        remote = self.fixed_remote or self._last_peer
        return {
            "local_host": self._bound_host,
            "local_port": self._bound_port,
            "remote": f"{remote[0]}:{remote[1]}" if remote else None,
            "remote_source": "configured" if self.fixed_remote else "last_sender",
        }
