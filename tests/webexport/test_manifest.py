import json

from webexport import manifest


def test_new_has_golden_and_night_only():
    m = manifest.new()
    assert list(m["states"]) == ["golden", "night"]
    assert m["states"]["golden"]["night"] == 0.6
    assert m["states"]["night"]["exposure"] == 0.75
    assert m["rgbmRange"] == 16.0


def test_merge_is_deep_and_persistent(tmp_path):
    p = tmp_path / "manifest.json"
    manifest.merge(p, manifest.new())
    manifest.merge(p, {"states": {"golden": {"lightmaps": {"bowl": "lightmaps/golden/bowl.png"}}}})
    m = json.loads(p.read_text())
    assert m["states"]["golden"]["night"] == 0.6
    assert m["states"]["golden"]["lightmaps"]["bowl"].endswith("bowl.png")
