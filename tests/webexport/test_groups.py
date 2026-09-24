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
