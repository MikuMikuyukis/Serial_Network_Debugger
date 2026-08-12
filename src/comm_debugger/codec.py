from __future__ import annotations

import re
from typing import Literal


PayloadFormat = Literal["text", "hex"]
LineEnding = Literal["none", "cr", "lf", "crlf"]

_LINE_ENDINGS: dict[LineEnding, bytes] = {
    "none": b"",
    "cr": b"\r",
    "lf": b"\n",
    "crlf": b"\r\n",
}


def parse_hex(value: str) -> bytes:
    """Parse common spaced or compact hexadecimal input."""
    cleaned = re.sub(r"0[xX]", "", value)
    cleaned = re.sub(r"[\s,;:_-]+", "", cleaned)

    if not cleaned:
        return b""
    if not re.fullmatch(r"[0-9a-fA-F]+", cleaned):
        raise ValueError("HEX 数据包含非十六进制字符")
    if len(cleaned) % 2:
        raise ValueError("HEX 数据必须由完整字节组成（每字节两位）")
    return bytes.fromhex(cleaned)


def encode_payload(
    value: str,
    payload_format: PayloadFormat,
    text_encoding: str = "utf-8",
    line_ending: LineEnding = "none",
) -> bytes:
    if payload_format == "hex":
        payload = parse_hex(value)
    else:
        try:
            payload = value.encode(text_encoding)
        except LookupError as exc:
            raise ValueError(f"不支持的文本编码：{text_encoding}") from exc
        except UnicodeEncodeError as exc:
            raise ValueError(f"文本无法使用 {text_encoding} 编码") from exc

    return payload + _LINE_ENDINGS[line_ending]


def format_data(data: bytes) -> tuple[str, str]:
    return data.hex(" ").upper(), data.decode("utf-8", errors="replace")
