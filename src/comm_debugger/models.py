from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, field_validator, model_validator


class SerialConfig(BaseModel):
    mode: Literal["serial"]
    port: str = Field(min_length=1, max_length=260)
    baudrate: int = Field(default=115200, ge=50, le=4_000_000)
    bytesize: Literal[5, 6, 7, 8] = 8
    parity: Literal["N", "E", "O", "M", "S"] = "N"
    stopbits: Literal[1, 1.5, 2] = 1


class TcpClientConfig(BaseModel):
    mode: Literal["tcp_client"]
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    connect_timeout: float = Field(default=8.0, gt=0, le=60)


class TcpServerConfig(BaseModel):
    mode: Literal["tcp_server"]
    host: str = Field(default="0.0.0.0", min_length=1, max_length=253)
    port: int = Field(ge=0, le=65535)


class UdpConfig(BaseModel):
    mode: Literal["udp"]
    local_host: str = Field(default="0.0.0.0", min_length=1, max_length=253)
    local_port: int = Field(default=0, ge=0, le=65535)
    remote_host: str | None = Field(default=None, max_length=253)
    remote_port: int | None = Field(default=None, ge=1, le=65535)

    @field_validator("remote_host")
    @classmethod
    def normalize_remote_host(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def validate_remote_pair(self) -> "UdpConfig":
        if (self.remote_host is None) != (self.remote_port is None):
            raise ValueError("UDP 远端地址和端口必须同时填写或同时留空")
        return self


TransportConfig = Annotated[
    Union[SerialConfig, TcpClientConfig, TcpServerConfig, UdpConfig],
    Field(discriminator="mode"),
]


class SendRequest(BaseModel):
    data: str
    format: Literal["text", "hex"] = "text"
    text_encoding: Literal["utf-8", "ascii", "gbk"] = "utf-8"
    line_ending: Literal["none", "cr", "lf", "crlf"] = "none"


class OperationResult(BaseModel):
    ok: bool = True
    message: str
