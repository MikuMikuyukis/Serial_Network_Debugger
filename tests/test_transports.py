from __future__ import annotations

import asyncio

from comm_debugger.events import EventBroker
from comm_debugger.models import TcpClientConfig, TcpServerConfig, UdpConfig
from comm_debugger.transports.tcp import TcpClientTransport, TcpServerTransport
from comm_debugger.transports.udp import UdpTransport


async def next_data_event(
    queue: asyncio.Queue[dict[str, object]],
    direction: str,
) -> dict[str, object]:
    async with asyncio.timeout(2):
        while True:
            event = await queue.get()
            if event.get("type") == "data" and event.get("direction") == direction:
                return event


def test_tcp_server_receives_and_broadcasts() -> None:
    async def scenario() -> None:
        broker = EventBroker()
        server = TcpServerTransport(
            TcpServerConfig(mode="tcp_server", host="127.0.0.1", port=0),
            broker,
        )
        async with broker.subscribe() as events:
            await server.start()
            port = server.snapshot()["details"]["port"]
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            await asyncio.sleep(0)

            writer.write(b"from-client")
            await writer.drain()
            received = await next_data_event(events, "rx")
            assert received["text"] == "from-client"

            await server.send(b"from-server")
            assert await asyncio.wait_for(reader.readexactly(11), timeout=2) == b"from-server"
            sent = await next_data_event(events, "tx")
            assert sent["size"] == 11

            writer.close()
            await writer.wait_closed()
            await server.stop()

    asyncio.run(scenario())


def test_tcp_client_uses_real_stream() -> None:
    async def scenario() -> None:
        async def echo(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            data = await reader.read(1024)
            writer.write(data.upper())
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        echo_server = await asyncio.start_server(echo, "127.0.0.1", 0)
        port = echo_server.sockets[0].getsockname()[1]
        broker = EventBroker()
        client = TcpClientTransport(
            TcpClientConfig(mode="tcp_client", host="127.0.0.1", port=port),
            broker,
        )
        async with broker.subscribe() as events:
            await client.start()
            await client.send(b"hello")
            received = await next_data_event(events, "rx")
            assert received["text"] == "HELLO"
            await client.stop()
        echo_server.close()
        await echo_server.wait_closed()

    asyncio.run(scenario())


def test_udp_transports_exchange_datagrams() -> None:
    async def scenario() -> None:
        broker_a = EventBroker()
        broker_b = EventBroker()
        endpoint_b = UdpTransport(
            UdpConfig(mode="udp", local_host="127.0.0.1", local_port=0),
            broker_b,
        )
        await endpoint_b.start()
        port_b = endpoint_b.snapshot()["details"]["local_port"]
        endpoint_a = UdpTransport(
            UdpConfig(
                mode="udp",
                local_host="127.0.0.1",
                local_port=0,
                remote_host="127.0.0.1",
                remote_port=port_b,
            ),
            broker_a,
        )

        async with broker_a.subscribe() as events_a, broker_b.subscribe() as events_b:
            await endpoint_a.start()
            await endpoint_a.send(b"ping")
            received_b = await next_data_event(events_b, "rx")
            assert received_b["text"] == "ping"

            await endpoint_b.send(b"pong")
            received_a = await next_data_event(events_a, "rx")
            assert received_a["text"] == "pong"

        await endpoint_a.stop()
        await endpoint_b.stop()

    asyncio.run(scenario())
