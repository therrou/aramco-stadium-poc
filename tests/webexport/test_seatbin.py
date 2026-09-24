import os
import struct

import pytest

from webexport import seatbin

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSV = os.path.join(REPO, "data", "seats.csv")

ROWS = [(101, 1, 1, -3.25, -45.696, 1.2, 1.5707),
        (344, 28, 50, 105.646, 90.446, 31.871, -2.3562)]


def test_record_is_19_bytes_and_header_16():
    data = seatbin.pack(ROWS)
    assert len(data) == 16 + 19 * len(ROWS)
    magic, ver, count, _ = struct.unpack_from("<4sIII", data, 0)
    assert (magic, ver, count) == (b"SEAT", 1, 2)


def test_roundtrip_quantisation():
    out = seatbin.unpack(seatbin.pack(ROWS))
    for a, b in zip(ROWS, out):
        assert a[:3] == b[:3]
        for u, v in zip(a[3:6], b[3:6]):
            assert abs(u - v) < 1e-4
        assert abs(a[6] - b[6]) < 2e-3          # f16 yaw: ~0.1 degree


def test_bad_magic_rejected():
    data = bytearray(seatbin.pack(ROWS))
    data[0:4] = b"NOPE"
    with pytest.raises(ValueError, match="magic"):
        seatbin.unpack(bytes(data))


def test_truncated_rejected():
    with pytest.raises(ValueError, match="length"):
        seatbin.unpack(seatbin.pack(ROWS)[:-1])


def test_real_csv_counts():
    rows = seatbin.read_csv(CSV)
    assert len(rows) == 46074
    assert len({r[0] for r in rows}) == 132
    assert max(r[1] for r in rows) < 256 and max(r[2] for r in rows) < 65536
