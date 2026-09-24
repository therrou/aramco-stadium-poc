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


def _is_section_contiguous(rows):
    seen, section = set(), None
    for r in rows:
        if r[0] != section:
            if r[0] in seen:
                return False
            seen.add(r[0])
            section = r[0]
    return True


def test_real_csv_is_not_section_contiguous():
    """data/seats.csv is row-major across sections (row 1 of every section, then row 2, ...);
    this pins that fact so the exporter keeps sorting it, see test_sort_by_section below."""
    assert not _is_section_contiguous(seatbin.read_csv(CSV))


def test_sort_by_section_makes_it_contiguous():
    rows = seatbin.sort_by_section(seatbin.read_csv(CSV))
    assert _is_section_contiguous(rows)
    assert len({r[0] for r in rows}) == 132


def test_sort_by_section_is_stable_within_a_section():
    rows = seatbin.read_csv(CSV)
    original_order = [(r[0], r[1], r[2]) for r in rows if r[0] == 101]
    sorted_order = [(r[0], r[1], r[2]) for r in seatbin.sort_by_section(rows) if r[0] == 101]
    assert sorted_order == original_order
