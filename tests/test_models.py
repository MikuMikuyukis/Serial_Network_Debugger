from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from comm_debugger.models import TransportConfig, UdpConfig


transport_adapter = TypeAdapter(TransportConfig)


def test_transport_config_uses_mode_discriminator() -> None:
    config = transport_adapter.validate_python(
        {"mode": "tcp_client", "host": "127.0.0.1", "port": 9000}
    )
    assert config.mode == "tcp_client"
    assert config.port == 9000


def test_udp_remote_must_be_complete_pair() -> None:
    with pytest.raises(ValidationError):
        UdpConfig(
            mode="udp",
            local_host="127.0.0.1",
            local_port=0,
            remote_host="127.0.0.1",
        )
