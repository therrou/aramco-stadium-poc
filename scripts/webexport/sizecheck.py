"""Total size of the shipped assets vs the 35 MB first-load target."""
import argparse
import os
import sys


def total_mb(root):
    rows = []
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            rows.append((os.path.relpath(p, root), os.path.getsize(p)))
    rows.sort(key=lambda r: -r[1])
    return sum(s for _, s in rows) / 2**20, rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--limit", type=float, default=35.0)
    a = ap.parse_args(argv)
    total, rows = total_mb(a.root)
    for name, size in rows[:15]:
        print(f"{size / 2**20:8.2f} MB  {name}")
    print(f"{total:8.2f} MB  TOTAL (limit {a.limit} MB)")
    return 0 if total <= a.limit else 1


if __name__ == "__main__":
    sys.exit(main())
