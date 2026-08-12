from __future__ import annotations

import asyncio
import json
import socket

import uvicorn
import websockets

from comm_debugger.app import app


def test_uvicorn_serves_real_websocket_connection() -> None:
    async def scenario() -> None:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        listener.setblocking(False)
        port = listener.getsockname()[1]

        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            lifespan="off",
        )
        server = uvicorn.Server(config)
        server_task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            async with asyncio.timeout(3):
                while not server.started:
                    await asyncio.sleep(0.01)

            async with websockets.connect(f"ws://127.0.0.1:{port}/ws/events") as websocket:
                event = json.loads(await asyncio.wait_for(websocket.recv(), timeout=2))
                assert event["type"] == "status"
                assert event["status"]["connected"] is False
        finally:
            server.should_exit = True
            await asyncio.wait_for(server_task, timeout=3)
            listener.close()

    asyncio.run(scenario())
