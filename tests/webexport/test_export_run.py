"""export_web.run passes `samples` to the bake stage only (final review 3). bpy is stubbed."""
import sys
from unittest.mock import MagicMock

sys.modules.setdefault("bpy", MagicMock())
sys.modules.setdefault("bmesh", MagicMock())
sys.modules.setdefault("mathutils", MagicMock())

import export_web  # noqa: E402


def test_run_passes_samples_to_bake_only(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(export_web, "_reload", lambda: None)
    monkeypatch.setattr(export_web, "RAW", str(tmp_path))
    monkeypatch.setattr(export_web, "STAGES", {
        "data": lambda r: calls.append(("data",)),
        "geometry": lambda r, q: calls.append(("geometry", q)),
        "bake": lambda r, q, samples=None: calls.append(("bake", q, samples)),
    })
    rep = export_web.run(stages=("data", "geometry", "bake"), quality="draft", samples=256)
    assert calls == [("data",), ("geometry", "draft"), ("bake", "draft", 256)]
    assert rep["samples"] == 256 and (tmp_path / "report.json").exists()


def test_run_default_samples_is_none(monkeypatch, tmp_path):
    seen = []
    monkeypatch.setattr(export_web, "_reload", lambda: None)
    monkeypatch.setattr(export_web, "RAW", str(tmp_path))
    monkeypatch.setattr(export_web, "STAGES", {"bake": lambda r, q, samples=None: seen.append(samples)})
    export_web.run(stages=("bake",))
    assert seen == [None]
