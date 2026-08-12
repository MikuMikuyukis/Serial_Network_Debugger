from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any

from comm_debugger.events import EventBroker
from comm_debugger.models import TcpClientConfig, TcpServerConfig
from comm_debugger.transports.base import BaseTransport, TransportError


def _peer_name(writer: asyncio.StreamWriter) -> str:
    peer = writer.get_extra_info("peername")
    if isinstance(peer, tuple) and len(peer) >= 2:
        return f"{peer[0]}:{peer[1]}"
    return str(peer or "未知客户端")


class TcpClientTransport(BaseTransport):
    mode = "tcp_client"

    def __init__(self, config: TcpClientConfig, broker: EventBroker) -> None:
        super().__init__(broker)
        self.config = config
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._write_lock = asyncio.Lock()

    async def start(self) -> None:
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.config.host, self.config.port),
                timeout=self.config.connect_timeout,
            )
        except (TimeoutError, OSError) as exc:
            self._reader = None
            self._writer = None
            raise TransportError(
                f"无法连接 TCP {self.config.host}:{self.config.port}：{exc}"
            ) from exc

        self.connected = True
        self._reader_task = asyncio.create_task(self._read_loop(), name="tcp-client-reader")
        self.publish_notice(f"已连接 TCP {self.config.host}:{self.config.port}")
        self.publish_status()

    async def stop(self) -> None:
        self.connected = False
        writer, self._writer = self._writer, None
        self._reader = None
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()

        task, self._reader_task = self._reader_task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        self.publish_status()

    async def send(self, data: bytes) -> None:
        writer = self._writer
        if not self.connected or writer is None or writer.is_closing():
            raise TransportError("TCP Client 尚未连接")
        if not data:
            return
        try:
            async with self._write_lock:
                writer.write(data)
                await writer.drain()
        except (ConnectionError, OSError) as exc:
            raise TransportError(f"TCP 发送失败：{exc}") from exc
        self.publish_data("tx", data, f"{self.config.host}:{self.config.port}")

    def details(self) -> dict[str, Any]:
        return {"host": self.config.host, "port": self.config.port}

    async def _read_loop(self) -> None:
        assert self._reader is not None
        try:
            while self.connected:
                data = await self._reader.read(65536)
                if not data:
                    break
                self.publish_data("rx", data, f"{self.config.host}:{self.config.port}")
        except asyncio.CancelledError:
            raise
        except (ConnectionError, OSError) as exc:
            if self.connected:
                self.publish_error(f"TCP 连接读取失败：{exc}")
        finally:
            if self.connected:
                self.connected = False
                self.publish_notice("TCP 远端已断开")
                self.publish_status()


class TcpServerTransport(BaseTransport):
    mode = "tcp_server"

    def __init__(self, config: TcpServerConfig, broker: EventBroker) -> None:
        super().__init__(broker)
        self.config = config
        self._server: asyncio.Server | None = None
        self._clients: dict[asyncio.StreamWriter, asyncio.Task[None]] = {}
        self._write_lock = asyncio.Lock()
        self._bound_host = config.host
        self._bound_port = config.port

    async def start(self) -> None:
        try:
            self._server = await asyncio.start_server(
                self._accept_client,
                self.config.host,
                self.config.port,
            )
        except OSError as exc:
            raise TransportError(
                f"无法监听 TCP {self.config.host}:{self.config.port}：{exc}"
            ) from exc

        sockets = self._server.sockets or []
        if sockets:
            address = sockets[0].getsockname()
            self._bound_host = str(address[0])
            self._bound_port = int(address[1])
        self.connected = True
        self.publish_notice(f"TCP Server 正在监听 {self._bound_host}:{self._bound_port}")
        self.publish_status()

    async def stop(self) -> None:
        self.connected = False
        server, self._server = self._server, None
        if server is not None:
            server.close()
            await server.wait_closed()

        clients = tuple(self._clients.items())
        self._clients.clear()
        for writer, _ in clients:
            writer.close()
        for writer, task in clients:
            with suppress(Exception):
                await writer.wait_closed()
            if task is not asyncio.current_task():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        self.publish_status()

    async def send(self, data: bytes) -> None:
        if not self.connected:
            raise TransportError("TCP Server 尚未启动")
        clients = [writer for writer in self._clients if not writer.is_closing()]
        if not clients:
            raise TransportError("当前没有 TCP 客户端连接")
        if not data:
            return

        failed: list[asyncio.StreamWriter] = []
        async with self._write_lock:
            for writer in clients:
                try:
                    writer.write(data)
                    await writer.drain()
                except (ConnectionError, OSError):
                    failed.append(writer)
        for writer in failed:
            await self._remove_client(writer)
        if len(failed) == len(clients):
            raise TransportError("向所有 TCP 客户端发送均失败")
        self.publish_data("tx", data, f"广播至 {len(clients) - len(failed)} 个客户端")

    def details(self) -> dict[str, Any]:
        return {
            "host": self._bound_host,
            "port": self._bound_port,
            "client_count": len(self._clients),
            "clients": [_peer_name(writer) for writer in self._clients],
        }

    async def _accept_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        task = asyncio.current_task()
        assert task is not None
        self._clients[writer] = task
        peer = _peer_name(writer)
        self.publish_notice(f"TCP 客户端已连接：{peer}")
        self.publish_status()
        try:
            while self.connected:
                data = await reader.read(65536)
                if not data:
                    break
                self.publish_data("rx", data, peer)
        except asyncio.CancelledError:
            raise
        except (ConnectionError, OSError) as exc:
            if self.connected:
                self.publish_error(f"TCP 客户端 {peer} 读取失败：{exc}")
        finally:
            await self._remove_client(writer)

    async def _remove_client(self, writer: asyncio.StreamWriter) -> None:
        if writer not in self._clients:
            return
        self._clients.pop(writer, None)
        peer = _peer_name(writer)
        writer.close()
        with suppress(Exception):
            await writer.wait_closed()
        self.publish_notice(f"TCP 客户端已断开：{peer}")
        self.publish_status()
