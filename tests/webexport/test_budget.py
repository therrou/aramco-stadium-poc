from webexport import budget


def test_check_passes_and_fails():
    ok = {"triangles": 1_500_000, "first_load_mb": 30.0}
    assert budget.check(ok) == []
    bad = {"triangles": 2_100_000, "first_load_mb": 36.0}
    msgs = budget.check(bad)
    assert len(msgs) == 2 and "triangles" in msgs[0]


def test_near_radius_shrinks_to_fit():
    trees = [("a", float(d)) for d in range(1, 301)]          # one tree per metre
    r = budget.near_radius(trees, {"a": 1000}, budget=100_000)
    assert 99 <= r < 101                                        # 100 trees fit
    assert budget.near_radius(trees, {"a": 1}, budget=10**9) == 250.0
