from __future__ import annotations

import asyncio
from collections import deque

import pytest
from pydantic import ValidationError

from comm_debugger.events import EventBroker
from comm_debugger.models import SerialConfig
from comm_debugger.transports.serial_port import SerialTransport


class ChunkedSerial:
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = deque(chunks)

    @property
    def in_waiting(self) -> int:
        return len(self.chunks[0]) if self.chunks else 0

    def read(self, size: int) -> bytes:
        if not self.chunks:
            return b""
        chunk = self.chunks.popleft()
        assert len(chunk) <= size
        return chunk


def make_transport(receive_idle_ms: int = 1) -> SerialTransport:
    config = SerialConfig(
        mode="serial",
        port="loopback",
        baudrate=115200,
        receive_idle_ms=receive_idle_ms,
    )
    return SerialTransport(config, EventBroker())


def test_receive_burst_merges_fragmented_os_reads() -> None:
    async def scenario() -> None:
        transport = make_transport()
        serial_port = ChunkedSerial([b"e", b"st_DATA"])

        merged = await transport._collect_receive_burst(serial_port, b"T")

        assert merged == b"Test_DATA"
        assert not serial_port.chunks

    asyncio.run(scenario())


def test_receive_burst_stops_after_idle_interval() -> None:
    async def scenario() -> None:
        transport = make_transport()
        serial_port = ChunkedSerial([])

        merged = await transport._collect_receive_burst(serial_port, b"first")

        assert merged == b"first"

    asyncio.run(scenario())


@pytest.mark.parametrize("value", [0, 1001])
def test_receive_idle_interval_is_bounded(value: int) -> None:
    with pytest.raises(ValidationError):
        SerialConfig(mode="serial", port="loopback", receive_idle_ms=value)
