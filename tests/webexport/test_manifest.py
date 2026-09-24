import json

from webexport import manifest


def test_new_has_three_states():
    m = manifest.new()
    assert list(m["states"]) == ["day", "golden", "night"]
    assert m["states"]["golden"]["night"] == 0.6
    assert m["states"]["night"]["exposure"] == 0.75
    assert m["rgbmRange"] == 16.0


def test_merge_is_deep_and_persistent(tmp_path):
    p = tmp_path / "manifest.json"
    manifest.merge(p, manifest.new())
    manifest.merge(p, {"states": {"day": {"lightmaps": {"bowl": "lightmaps/day/bowl.png"}}}})
    m = json.loads(p.read_text())
    assert m["states"]["day"]["night"] == 0.0
    assert m["states"]["day"]["lightmaps"]["bowl"].endswith("bowl.png")
