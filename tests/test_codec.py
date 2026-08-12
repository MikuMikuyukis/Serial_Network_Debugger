from __future__ import annotations

import pytest

from comm_debugger.codec import encode_payload, format_data, parse_hex


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("AA 55 01", b"\xaa\x55\x01"),
        ("0xAA,0x55;01", b"\xaa\x55\x01"),
        ("aa55_01", b"\xaa\x55\x01"),
        ("", b""),
    ],
)
def test_parse_hex_accepts_common_notation(value: str, expected: bytes) -> None:
    assert parse_hex(value) == expected


@pytest.mark.parametrize("value", ["ABC", "GG", "01.ZZ"])
def test_parse_hex_rejects_invalid_input(value: str) -> None:
    with pytest.raises(ValueError):
        parse_hex(value)


def test_encode_text_with_line_ending() -> None:
    assert encode_payload("你好", "text", "utf-8", "crlf") == "你好\r\n".encode()


def test_format_data_provides_hex_and_safe_text() -> None:
    assert format_data(b"A\xff") == ("41 FF", "A�")
