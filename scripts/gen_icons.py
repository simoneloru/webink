#!/usr/bin/env python3
"""Generate simple PNG icons without external deps (minimal valid PNG)."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path


def png_gray(size: int, value: int = 0xE8) -> bytes:
    """Solid gray square PNG."""
    raw = b""
    for _ in range(size):
        raw += b"\x00" + bytes([value]) * size
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", zlib.crc32(tag + data) & 0xFFFFFFFF
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(
        b"IEND", b""
    )


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "www" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    (out / "icon-192.png").write_bytes(png_gray(192))
    (out / "icon-512.png").write_bytes(png_gray(512))
    print(f"Wrote icons under {out}")


if __name__ == "__main__":
    main()
