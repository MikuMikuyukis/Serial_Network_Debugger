from __future__ import annotations

from fastapi.testclient import TestClient

from comm_debugger.app import app


def test_health_and_frontend_are_served() -> None:
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"

        frontend = client.get("/")
        assert frontend.status_code == 200
        assert "Serial Network Debugger" in frontend.text


def test_websocket_starts_with_status_snapshot() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/events") as websocket:
            event = websocket.receive_json()
            assert event["type"] == "status"
            assert event["status"]["connected"] is False


def test_send_requires_connection() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/send",
            json={"data": "AA 55", "format": "hex"},
        )
        assert response.status_code == 400
        assert "连接" in response.json()["detail"]
