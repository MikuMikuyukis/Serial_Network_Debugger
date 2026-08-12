from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any

import serial

from comm_debugger.events import EventBroker
from comm_debugger.models import SerialConfig
from comm_debugger.transports.base import BaseTransport, TransportError


class SerialTransport(BaseTransport):
    mode = "serial"
    _MAX_RECEIVE_CHUNK = 65536

    def __init__(self, config: SerialConfig, broker: EventBroker) -> None:
        super().__init__(broker)
        self.config = config
        self._serial: serial.Serial | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._write_lock = asyncio.Lock()
        self._event_lock = asyncio.Lock()

    async def start(self) -> None:
        try:
            self._serial = await asyncio.to_thread(
                serial.Serial,
                port=self.config.port,
                baudrate=self.config.baudrate,
                bytesize=self.config.bytesize,
                parity=self.config.parity,
                stopbits=self.config.stopbits,
                timeout=0.1,
                write_timeout=2,
            )
        except (OSError, serial.SerialException, ValueError) as exc:
            self._serial = None
            raise TransportError(f"无法打开串口 {self.config.port}：{exc}") from exc

        self.connected = True
        self._reader_task = asyncio.create_task(self._read_loop(), name="serial-reader")
        self.publish_notice(f"串口 {self.config.port} 已打开")
        self.publish_status()

    async def stop(self) -> None:
        self.connected = False
        serial_port, self._serial = self._serial, None
        if serial_port is not None:
            with suppress(Exception):
                await asyncio.to_thread(serial_port.close)

        task, self._reader_task = self._reader_task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        self.publish_status()

    async def send(self, data: bytes) -> None:
        serial_port = self._serial
        if not self.connected or serial_port is None or not serial_port.is_open:
            raise TransportError("串口尚未打开")
        if not data:
            return

        try:
            async with self._write_lock:
                async with self._event_lock:
                    written = await asyncio.to_thread(serial_port.write, data)
                    if written != len(data):
                        raise TransportError(f"串口仅发送了 {written}/{len(data)} 字节")
                    await asyncio.to_thread(serial_port.flush)
                    self.publish_data("tx", data)
        except (OSError, serial.SerialException) as exc:
            raise TransportError(f"串口发送失败：{exc}") from exc

    def details(self) -> dict[str, Any]:
        return {
            "port": self.config.port,
            "baudrate": self.config.baudrate,
            "bytesize": self.config.bytesize,
            "parity": self.config.parity,
            "stopbits": self.config.stopbits,
            "receive_idle_ms": self.config.receive_idle_ms,
        }

    async def _read_loop(self) -> None:
        assert self._serial is not None
        serial_port = self._serial
        try:
            while self.connected and serial_port.is_open:
                waiting = serial_port.in_waiting
                data = await asyncio.to_thread(serial_port.read, max(1, min(waiting, 65536)))
                if data:
                    merged = await self._collect_receive_burst(serial_port, data)
                    async with self._event_lock:
                        self.publish_data("rx", merged)
        except asyncio.CancelledError:
            raise
        except (OSError, serial.SerialException) as exc:
            if self.connected:
                self.connected = False
                self.publish_error(f"串口读取中断：{exc}")
                self.publish_status()

    async def _collect_receive_burst(
        self,
        serial_port: serial.Serial,
        initial: bytes,
    ) -> bytes:
        buffer = bytearray(initial)
        idle_seconds = self.config.receive_idle_ms / 1000

        while len(buffer) < self._MAX_RECEIVE_CHUNK:
            await asyncio.sleep(idle_seconds)
            waiting = serial_port.in_waiting
            if waiting <= 0:
                break
            remaining = self._MAX_RECEIVE_CHUNK - len(buffer)
            data = await asyncio.to_thread(serial_port.read, min(waiting, remaining))
            if not data:
                break
            buffer.extend(data)

        return bytes(buffer)
