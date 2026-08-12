from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from serial.tools import list_ports

from comm_debugger.codec import encode_payload
from comm_debugger.events import EventBroker
from comm_debugger.manager import TransportManager
from comm_debugger.models import OperationResult, SendRequest, TransportConfig
from comm_debugger.transports import TransportError


STATIC_DIR = Path(__file__).parent / "static"
broker = EventBroker()
manager = TransportManager(broker)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await manager.disconnect()


app = FastAPI(
    title="Serial Network Debugger",
    version="0.1.0",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version}


@app.get("/api/status")
async def status() -> dict[str, object]:
    return manager.snapshot()


@app.get("/api/serial/ports")
async def serial_ports() -> list[dict[str, str | None]]:
    ports = await asyncio.to_thread(list_ports.comports)
    return [
        {
            "device": port.device,
            "description": port.description,
            "manufacturer": port.manufacturer,
            "hwid": port.hwid,
        }
        for port in sorted(ports, key=lambda item: item.device)
    ]


@app.post("/api/connect")
async def connect(config: TransportConfig) -> dict[str, object]:
    try:
        return await manager.connect(config)
    except (TransportError, OSError, ValueError) as exc:
        broker.publish({"type": "error", "message": str(exc)})
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/disconnect", response_model=OperationResult)
async def disconnect() -> OperationResult:
    await manager.disconnect()
    return OperationResult(message="通信连接已关闭")


@app.post("/api/send", response_model=OperationResult)
async def send(request: SendRequest) -> OperationResult:
    try:
        payload = encode_payload(
            request.data,
            request.format,
            request.text_encoding,
            request.line_ending,
        )
        if not payload:
            raise ValueError("发送内容不能为空")
        await manager.send(payload)
    except (TransportError, ValueError) as exc:
        broker.publish({"type": "error", "message": str(exc)})
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return OperationResult(message=f"已发送 {len(payload)} 字节")


@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json({"type": "status", "status": manager.snapshot()})
    try:
        async with broker.subscribe() as queue:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                except TimeoutError:
                    event = {"type": "ping"}
                await websocket.send_json(event)
    except (WebSocketDisconnect, RuntimeError):
        pass
