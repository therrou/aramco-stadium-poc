from webexport import groups


def test_groups():
    assert groups.group_of("Shell", "M_SailSkin") == "sails"
    assert groups.group_of("Shell", "M_Steel") == "structure"
    assert groups.group_of("Bowl", "M_Concrete") == "bowl"
    assert groups.group_of("Site", "M_Paving") == "site"
    assert groups.group_of("Pitch", "M_Grass") == "pitch"


def test_exclusions():
    for n in ("Seats_Upper", "SeatModel", "SeatModelClub", "Trees_Palm_0", "Crowd_Person_Dark",
              "Haze_Volume", "Sign_Path"):
        assert groups.is_excluded(n)
    for n in ("Podium_Deck", "Cars", "Sign_AramcoStadium", "Bridge_NE_Glass"):
        assert not groups.is_excluded(n)


def test_site_near_split():
    out = groups.site_split("site", "M_Lawn", [True, True, False], [120.0, 450.0, 50.0])
    assert list(out) == ["site_near", "site", "site"]
    assert list(groups.site_split("bowl", "M_Concrete", [True], [10.0])) == ["bowl"]
    assert list(groups.site_split("site", "M_Car3", [True], [10.0])) == ["site"]
    assert "site_near" in groups.TEXELS_PER_M and "site_near" in groups.ALBEDO_TEXELS_PER_M
