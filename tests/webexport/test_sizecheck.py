from webexport import sizecheck


def test_total_and_limit(tmp_path):
    (tmp_path / "a.bin").write_bytes(b"x" * 1024 * 1024)
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "b.bin").write_bytes(b"x" * 512 * 1024)
    total, rows = sizecheck.total_mb(tmp_path)
    assert abs(total - 1.5) < 1e-6 and len(rows) == 2
    assert sizecheck.main([str(tmp_path), "--limit", "1.0"]) == 1
    assert sizecheck.main([str(tmp_path), "--limit", "2.0"]) == 0
