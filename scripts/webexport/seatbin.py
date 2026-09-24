"""seats.bin: every seat in Blender Z-up metres (see plan decision D1).

header  <4sIII  magic "SEAT", version, count, reserved
record  <HBHfffe section, row, seat, x, y, z, yaw   (19 bytes, no padding)
"""
import csv
import struct

MAGIC, VERSION = b"SEAT", 1
HEADER_FMT, RECORD_FMT = "<4sIII", "<HBHfffe"
HEADER, RECORD = struct.calcsize(HEADER_FMT), struct.calcsize(RECORD_FMT)
assert (HEADER, RECORD) == (16, 19)


def read_csv(path):
    with open(path) as f:
        return [(int(r["section"]), int(r["row"]), int(r["seat"]), float(r["x"]), float(r["y"]),
                 float(r["z"]), float(r["yaw"])) for r in csv.DictReader(f)]


def sort_by_section(rows):
    """Stable-sort rows by section (row 0), keeping row/seat order within a section.

    data/seats.csv is written row-major across sections (row 1 of every section, then row 2, ...),
    so seats.bin must be sorted here for it to be section-contiguous, which the web viewer's
    SeatTable/indexSections relies on."""
    return sorted(rows, key=lambda r: r[0])


def pack(rows):
    out = bytearray(struct.pack(HEADER_FMT, MAGIC, VERSION, len(rows), 0))
    for r in rows:
        out += struct.pack(RECORD_FMT, *r)
    return bytes(out)


def unpack(data):
    magic, version, count, _ = struct.unpack_from(HEADER_FMT, data, 0)
    if magic != MAGIC:
        raise ValueError(f"bad magic {magic!r}")
    if version != VERSION:
        raise ValueError(f"unsupported version {version}")
    if len(data) != HEADER + count * RECORD:
        raise ValueError(f"length {len(data)} != {HEADER + count * RECORD}")
    return [struct.unpack_from(RECORD_FMT, data, HEADER + i * RECORD) for i in range(count)]
