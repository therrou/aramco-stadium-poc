from webexport import sizecheck


def test_total_and_limit(tmp_path):
    (tmp_path / "a.bin").write_bytes(b"x" * 1024 * 1024)
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "b.bin").write_bytes(b"x" * 512 * 1024)
    total, rows = sizecheck.total_mb(tmp_path)
    assert abs(total - 1.5 * 2**20 / 1e6) < 1e-9 and len(rows) == 2     # decimal MB: 1,572,864 bytes
    assert sizecheck.main([str(tmp_path), "--limit", "1.0"]) == 1
    assert sizecheck.main([str(tmp_path), "--limit", "2.0"]) == 0


def test_limit_is_decimal_mb(tmp_path):
    (tmp_path / "a.bin").write_bytes(b"x" * 1_000_000)
    assert sizecheck.main([str(tmp_path), "--limit", "1.0"]) == 0          # exactly 1e6 bytes passes
    (tmp_path / "b.bin").write_bytes(b"x")
    assert sizecheck.main([str(tmp_path), "--limit", "1.0"]) == 1
