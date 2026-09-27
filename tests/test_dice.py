import random

import pytest

from pocket_dm import dice


def rng(seed=1):
    return random.Random(seed)


def test_plain_arithmetic():
    assert dice.calculate("1 + 2 * 3") == 7
    assert dice.calculate("(1 + 2) * 3") == 9
    assert dice.calculate("2 ^ 3 ^ 2") == 512  # right-associative
    assert dice.calculate("-3 + +5") == 2
    assert dice.calculate("7 // 2") == 3
    assert dice.calculate("7 / 2") == 3.5
    assert dice.calculate("7 % 3") == 1


def test_functions():
    assert dice.calculate("mod(18)") == 4
    assert dice.calculate("mod(9)") == -1
    assert dice.calculate("prof(1) + prof(5) + prof(17)") == 2 + 3 + 6
    assert dice.calculate("max(1, 5, 3) + min(4, 2)") == 7
    assert dice.calculate("floor(7/2) + ceil(7/2)") == 7


@pytest.mark.parametrize(
    "expr,lo,hi",
    [("d20", 1, 20), ("3d6", 3, 18), ("2d20kh1+5", 6, 25), ("4d6dl1", 3, 18), ("d%", 1, 100), ("4dF", -4, 4), ("8d6//2", 4, 24)],
)
def test_dice_ranges(expr, lo, hi):
    r = rng()
    for _ in range(300):
        assert lo <= dice.roll(expr, r).total <= hi


def test_keep_highest_keeps_max():
    r = rng(7)
    for _ in range(100):
        res = dice.roll("2d20kh1", r)
        values = [d.value for d in res.groups[0].rolls]
        assert res.total == max(values)
        assert sum(d.kept for d in res.groups[0].rolls) == 1


def test_keep_lowest_and_drop():
    r = rng(3)
    for _ in range(100):
        res = dice.roll("2d20kl1", r)
        assert res.total == min(d.value for d in res.groups[0].rolls)
        res = dice.roll("4d6dl1", r)
        vals = sorted(d.value for d in res.groups[0].rolls)
        assert res.total == sum(vals[1:])


def test_shorthand_and_default_counts():
    assert dice.roll("adv+5", rng()).expression == "2d20kh1+5"
    assert dice.roll("dis", rng()).expression == "2d20kl1"
    res = dice.roll("2d20kh", rng())
    assert sum(d.kept for d in res.groups[0].rolls) == 1


def test_exploding_dice_add_extra_rolls():
    class Fixed(random.Random):
        def __init__(self, seq):
            super().__init__()
            self.seq = list(seq)

        def randint(self, a, b):
            return self.seq.pop(0)

    res = dice.roll("1d6!", Fixed([6, 6, 2]))
    assert res.total == 14
    assert [d.exploded for d in res.groups[0].rolls] == [False, True, True]


def test_reroll_once():
    class Fixed(random.Random):
        def __init__(self, seq):
            super().__init__()
            self.seq = list(seq)

        def randint(self, a, b):
            return self.seq.pop(0)

    res = dice.roll("2d6ro2", Fixed([1, 2, 4]))  # 1 rerolls once into a 2 (kept), 4 stays
    assert res.total == 6
    assert [d.discarded for d in res.groups[0].rolls] == [True, False, False]


def test_crit_and_fumble_detection():
    class Fixed(random.Random):
        def __init__(self, v):
            super().__init__()
            self.v = v

        def randint(self, a, b):
            return self.v

    assert dice.roll("d20+5", Fixed(20)).critical
    assert dice.roll("d20+5", Fixed(1)).fumble
    assert dice.roll("3d6", Fixed(1)).natural is None


def test_breakdown_marks_dropped_dice():
    res = dice.roll("2d20kh1", rng(2))
    assert "~~" in res.breakdown
    assert res.breakdown.endswith(f"= {res.total}")


@pytest.mark.parametrize(
    "bad",
    ["", "2d", "d0", "1001d6", "5d6kh9", "1/0", "foo(2)", "2+", "3d6r6", "(1+2", "2d6kh1dl1", "import os", "__import__('os')", "1d6!" * 200],
)
def test_invalid_expressions_raise(bad):
    with pytest.raises(dice.DiceError):
        dice.roll(bad)


def test_huge_exponent_rejected():
    with pytest.raises(dice.DiceError):
        dice.calculate("9^9^9")


def test_roll_stats():
    stats = dice.roll_stats(rng())
    assert len(stats) == 6
    assert all(3 <= s.total <= 18 for s in stats)
