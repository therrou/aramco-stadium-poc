"""bake.resolve_samples is pure (no bpy at module scope in bake.py), but bake.py imports bpy at
the top of the file, so stub it in sys.modules before import (host pytest, per fullbake-brief)."""
import sys
from unittest.mock import MagicMock

sys.modules.setdefault("bpy", MagicMock())
sys.modules.setdefault("bmesh", MagicMock())
sys.modules.setdefault("mathutils", MagicMock())

from webexport import bake  # noqa: E402


def test_resolve_samples_defaults_to_quality_table():
    assert bake.resolve_samples("draft") == bake.QUALITY["draft"]["samples"] == 64
    assert bake.resolve_samples("full") == bake.QUALITY["full"]["samples"] == 256


def test_resolve_samples_override_ignores_quality_table():
    # e.g. a full-quality bake at 256 samples that reuses the "draft" UV layout/atlas scale
    assert bake.resolve_samples("draft", 256) == 256


def test_resolve_samples_override_does_not_touch_scale():
    q = bake.QUALITY["draft"]
    bake.resolve_samples("draft", 256)
    assert bake.QUALITY["draft"] is q
    assert bake.QUALITY["draft"]["scale"] == 0.5


def test_full_quality_shares_the_draft_atlas_scale():
    # ruling R9: a "full" bake must stay UV/atlas-compatible with the shipped (draft-layout) assets
    assert bake.QUALITY["full"]["scale"] == bake.QUALITY["draft"]["scale"] == 0.5
