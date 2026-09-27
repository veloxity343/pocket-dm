"""Dice notation parser and safe arithmetic evaluator.

One engine powers both the dice roller and the calculator: an expression is
ordinary arithmetic in which dice terms may appear anywhere.

Dice syntax (case-insensitive)::

    d20            one twenty-sided die
    4d6kh3         roll 4d6, keep the highest 3   (also ``k3``)
    2d20kl1        keep lowest (disadvantage)
    4d6dl1         drop lowest                    (also ``dh``)
    2d20kh         a missing count means 1
    3d6!           exploding: roll again on max (capped)
    2d6ro1         reroll 1s once (``ro2`` = Great Weapon Fighting)
    2d6r1          reroll 1s until they stop being 1s (capped)
    d%             percentile die (d100)
    4dF            Fate/Fudge dice (-1, 0, +1)

Arithmetic: ``+ - * / // % ^`` and parentheses, plus functions
``floor ceil round abs min max sqrt`` and D&D helpers ``mod(score)`` (ability
modifier) and ``prof(level)`` (proficiency bonus).

Nothing here uses :func:`eval`; input is tokenised and parsed by hand.
"""

from __future__ import annotations

import math
import random
import re
from dataclasses import dataclass, field

MAX_DICE = 1000
MAX_SIDES = 100_000
MAX_EXPLOSIONS = 100
MAX_EXPR_LENGTH = 500


class DiceError(ValueError):
    """Raised for malformed expressions or out-of-range dice."""


# --------------------------------------------------------------------------- tokens

_DICE_RE = re.compile(
    r"(?P<count>\d+)?d(?P<sides>\d+|%|f)(?P<mods>(?:(?:kh|kl|dh|dl|k|ro|r)\d*|!)*)",
    re.IGNORECASE,
)
_MOD_RE = re.compile(r"(kh|kl|dh|dl|k|ro|r)(\d*)|(!)", re.IGNORECASE)
_NUM_RE = re.compile(r"\d+(?:\.\d+)?|\.\d+")
_NAME_RE = re.compile(r"[a-z_][a-z_0-9]*", re.IGNORECASE)
_OPS = ["//", "**", "+", "-", "*", "/", "%", "^", "(", ")", ","]


@dataclass
class Token:
    kind: str  # num, dice, name, op, end
    value: object
    pos: int


def tokenize(text: str) -> list[Token]:
    if len(text) > MAX_EXPR_LENGTH:
        raise DiceError(f"expression too long (max {MAX_EXPR_LENGTH} characters)")
    tokens: list[Token] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        m = _DICE_RE.match(text, i)
        if m:
            tokens.append(Token("dice", m, i))
            i = m.end()
            continue
        m = _NUM_RE.match(text, i)
        if m:
            raw = m.group()
            tokens.append(Token("num", float(raw) if "." in raw else int(raw), i))
            i = m.end()
            continue
        m = _NAME_RE.match(text, i)
        if m:
            tokens.append(Token("name", m.group().lower(), i))
            i = m.end()
            continue
        for op in _OPS:
            if text.startswith(op, i):
                tokens.append(Token("op", "^" if op == "**" else op, i))
                i += len(op)
                break
        else:
            raise DiceError(f"unexpected character {ch!r} at position {i + 1}")
    tokens.append(Token("end", None, len(text)))
    return tokens


# --------------------------------------------------------------------------- results


@dataclass
class DieRoll:
    value: int
    kept: bool = True
    exploded: bool = False  # this die was rolled because the previous one exploded
    rerolled: bool = False  # this value replaced a rerolled die
    discarded: bool = False  # this value was rerolled away

    def to_dict(self) -> dict:
        d = {"value": self.value, "kept": self.kept}
        for flag in ("exploded", "rerolled", "discarded"):
            if getattr(self, flag):
                d[flag] = True
        return d


@dataclass
class DiceGroup:
    notation: str
    count: int
    sides: int | str
    rolls: list[DieRoll] = field(default_factory=list)

    @property
    def total(self) -> int:
        return sum(r.value for r in self.rolls if r.kept and not r.discarded)

    def describe(self) -> str:
        parts = []
        for r in self.rolls:
            text = str(r.value)
            if r.discarded or not r.kept:
                text = f"~~{text}~~"
            if r.exploded:
                text += "!"
            parts.append(text)
        return f"{self.notation} [{', '.join(parts)}]"

    def to_dict(self) -> dict:
        return {
            "notation": self.notation,
            "count": self.count,
            "sides": self.sides,
            "total": self.total,
            "rolls": [r.to_dict() for r in self.rolls],
        }


@dataclass
class RollResult:
    expression: str
    total: int | float
    breakdown: str
    groups: list[DiceGroup]

    @property
    def natural(self) -> int | None:
        """The kept d20 value when the roll hinges on exactly one d20."""
        d20s = [g for g in self.groups if g.sides == 20]
        if len(d20s) != 1:
            return None
        kept = [r.value for r in d20s[0].rolls if r.kept and not r.discarded]
        return kept[0] if len(kept) == 1 else None

    @property
    def critical(self) -> bool:
        return self.natural == 20

    @property
    def fumble(self) -> bool:
        return self.natural == 1

    def to_dict(self) -> dict:
        return {
            "expression": self.expression,
            "total": self.total,
            "breakdown": self.breakdown,
            "groups": [g.to_dict() for g in self.groups],
            "natural": self.natural,
            "critical": self.critical,
            "fumble": self.fumble,
        }


# --------------------------------------------------------------------------- AST


class Node:
    def eval(self, ctx: "_Ctx") -> tuple[float, str]:  # value, rendered text
        raise NotImplementedError


@dataclass
class Num(Node):
    value: float

    def eval(self, ctx):
        return self.value, _fmt(self.value)


@dataclass
class Dice(Node):
    count: int
    sides: int | str  # int, or "F" for fate dice
    mods: list[tuple[str, int]]
    notation: str

    def eval(self, ctx):
        group = ctx.roll(self)
        return group.total, group.describe()


@dataclass
class Unary(Node):
    op: str
    operand: Node

    def eval(self, ctx):
        v, s = self.operand.eval(ctx)
        return (-v, f"-{s}") if self.op == "-" else (v, s)


@dataclass
class Binary(Node):
    op: str
    left: Node
    right: Node

    def eval(self, ctx):
        a, sa = self.left.eval(ctx)
        b, sb = self.right.eval(ctx)
        op = self.op
        if op in ("/", "//", "%") and b == 0:
            raise DiceError("division by zero")
        if op == "+":
            v = a + b
        elif op == "-":
            v = a - b
        elif op == "*":
            v = a * b
        elif op == "/":
            v = a / b
        elif op == "//":
            v = a // b
        elif op == "%":
            v = a % b
        elif op == "^":
            if abs(b) > 1000 or (abs(a) > 1 and b * math.log10(abs(a)) > 300):
                raise DiceError("exponent too large")
            v = a**b
            if isinstance(v, complex):
                raise DiceError("result is not a real number")
        else:  # pragma: no cover - parser guarantees the operator set
            raise DiceError(f"unknown operator {op}")
        return v, f"{sa} {op} {sb}"


@dataclass
class Group(Node):
    inner: Node

    def eval(self, ctx):
        v, s = self.inner.eval(ctx)
        return v, f"({s})"


def _prof(level):
    level = int(level)
    if not 1 <= level <= 30:
        raise DiceError("prof() takes a level from 1 to 30")
    return 2 + (level - 1) // 4


FUNCTIONS = {
    "floor": (1, 1, math.floor),
    "ceil": (1, 1, math.ceil),
    "round": (1, 2, lambda x, n=0: round(x, int(n)) if n else math.floor(x + 0.5)),
    "abs": (1, 1, abs),
    "min": (1, 99, min),
    "max": (1, 99, max),
    "sqrt": (1, 1, lambda x: _checked_sqrt(x)),
    "mod": (1, 1, lambda s: math.floor((s - 10) / 2)),
    "prof": (1, 1, _prof),
}

CONSTANTS = {"pi": math.pi, "e": math.e}


def _checked_sqrt(x):
    if x < 0:
        raise DiceError("sqrt of a negative number")
    return math.sqrt(x)


@dataclass
class Call(Node):
    name: str
    args: list[Node]

    def eval(self, ctx):
        lo, hi, fn = FUNCTIONS[self.name]
        if not lo <= len(self.args) <= hi:
            raise DiceError(f"{self.name}() takes {lo}{'' if lo == hi else f'-{hi}'} argument(s)")
        vals, texts = zip(*(a.eval(ctx) for a in self.args))
        return fn(*vals), f"{self.name}({', '.join(texts)})"


# --------------------------------------------------------------------------- parser


class _Parser:
    def __init__(self, text: str):
        self.text = text
        self.tokens = tokenize(text)
        self.i = 0

    def peek(self) -> Token:
        return self.tokens[self.i]

    def take(self) -> Token:
        tok = self.tokens[self.i]
        self.i += 1
        return tok

    def accept(self, *ops: str) -> str | None:
        tok = self.peek()
        if tok.kind == "op" and tok.value in ops:
            self.i += 1
            return tok.value
        return None

    def expect(self, op: str):
        if not self.accept(op):
            tok = self.peek()
            where = "end of input" if tok.kind == "end" else f"position {tok.pos + 1}"
            raise DiceError(f"expected {op!r} at {where}")

    def parse(self) -> Node:
        if self.peek().kind == "end":
            raise DiceError("empty expression")
        node = self.expr()
        tok = self.peek()
        if tok.kind != "end":
            raise DiceError(f"unexpected {self.text[tok.pos:tok.pos + 8]!r} at position {tok.pos + 1}")
        return node

    def expr(self) -> Node:
        node = self.term()
        while op := self.accept("+", "-"):
            node = Binary(op, node, self.term())
        return node

    def term(self) -> Node:
        node = self.unary()
        while op := self.accept("*", "/", "//", "%"):
            node = Binary(op, node, self.unary())
        return node

    def unary(self) -> Node:
        if op := self.accept("-", "+"):
            return Unary(op, self.unary())
        return self.power()

    def power(self) -> Node:
        node = self.atom()
        if self.accept("^"):
            node = Binary("^", node, self.unary())  # right-associative
        return node

    def atom(self) -> Node:
        tok = self.take()
        if tok.kind == "num":
            return Num(tok.value)
        if tok.kind == "dice":
            return _dice_node(tok.value)
        if tok.kind == "name":
            if tok.value in CONSTANTS:
                return Num(CONSTANTS[tok.value])
            if tok.value not in FUNCTIONS:
                raise DiceError(f"unknown name {tok.value!r}")
            self.expect("(")
            args = [self.expr()]
            while self.accept(","):
                args.append(self.expr())
            self.expect(")")
            return Call(tok.value, args)
        if tok.kind == "op" and tok.value == "(":
            inner = self.expr()
            self.expect(")")
            return Group(inner)
        if tok.kind == "end":
            raise DiceError("unexpected end of expression")
        raise DiceError(f"unexpected {tok.value!r} at position {tok.pos + 1}")


def _dice_node(m: re.Match) -> Dice:
    count = int(m.group("count")) if m.group("count") else 1
    raw_sides = m.group("sides").lower()
    sides: int | str = 100 if raw_sides == "%" else "F" if raw_sides == "f" else int(raw_sides)
    if not 1 <= count <= MAX_DICE:
        raise DiceError(f"dice count must be between 1 and {MAX_DICE}")
    if isinstance(sides, int) and not 1 <= sides <= MAX_SIDES:
        raise DiceError(f"dice sides must be between 1 and {MAX_SIDES}")
    mods: list[tuple[str, int]] = []
    for mm in _MOD_RE.finditer(m.group("mods") or ""):
        if mm.group(3):
            mods.append(("!", 0))
        else:
            kind = mm.group(1).lower()
            mods.append(("kh" if kind == "k" else kind, int(mm.group(2) or 1)))
    keeps = [k for k, _ in mods if k in ("kh", "kl", "dh", "dl")]
    if len(keeps) > 1:
        raise DiceError("use only one keep/drop modifier per dice term")
    for kind, n in mods:
        if kind in ("kh", "kl") and not 1 <= n <= count:
            raise DiceError(f"can't keep {n} of {count} dice")
        if kind in ("dh", "dl") and not 0 <= n < count:
            raise DiceError(f"can't drop {n} of {count} dice")
        if kind in ("r", "ro") and sides != "F" and n >= sides:
            raise DiceError(f"reroll threshold {n} would reroll every face of a d{sides}")
        if kind == "!" and sides in (1, "F"):
            raise DiceError("that die can't explode")
    return Dice(count, sides, mods, m.group(0))


# --------------------------------------------------------------------------- evaluation


class _Ctx:
    def __init__(self, rng: random.Random):
        self.rng = rng
        self.groups: list[DiceGroup] = []
        self.dice_rolled = 0

    def _die(self, sides) -> int:
        self.dice_rolled += 1
        if self.dice_rolled > MAX_DICE * 10:
            raise DiceError("too many dice rolled")
        if sides == "F":
            return self.rng.randint(-1, 1)
        return self.rng.randint(1, sides)

    def roll(self, d: Dice) -> DiceGroup:
        group = DiceGroup(d.notation, d.count, d.sides)
        mods = dict(d.mods)
        explode = "!" in mods
        for _ in range(d.count):
            chain = [DieRoll(self._die(d.sides))]
            # rerolls
            for kind in ("ro", "r"):
                if kind in mods:
                    limit = 1 if kind == "ro" else MAX_EXPLOSIONS
                    tries = 0
                    while chain[-1].value <= mods[kind] and tries < limit:
                        chain[-1].discarded = True
                        chain.append(DieRoll(self._die(d.sides), rerolled=True))
                        tries += 1
            # explosions
            if explode:
                tries = 0
                while chain[-1].value == d.sides and tries < MAX_EXPLOSIONS:
                    chain.append(DieRoll(self._die(d.sides), exploded=True))
                    tries += 1
            group.rolls.extend(chain)
        # keep / drop acts on the live (non-discarded) dice
        live = [r for r in group.rolls if not r.discarded]
        for kind in ("kh", "kl", "dh", "dl"):
            if kind not in mods:
                continue
            n = mods[kind]
            ordered = sorted(live, key=lambda r: r.value, reverse=kind in ("kh", "dh"))
            if kind in ("kh", "kl"):
                losers = ordered[n:]
            else:
                losers = ordered[:n]
            for r in losers:
                r.kept = False
        self.groups.append(group)
        return group


def _fmt(v: float) -> str:
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return str(int(v))
    if isinstance(v, float):
        return f"{v:.6g}"
    return str(v)


def _clean(v):
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return int(v)
    if isinstance(v, float):
        return round(v, 10)
    return v


def parse(expression: str) -> Node:
    """Parse an expression, raising :class:`DiceError` if it is invalid."""
    return _Parser(expression.strip()).parse()


def roll(expression: str, rng: random.Random | None = None) -> RollResult:
    """Evaluate a dice/arithmetic expression and return the full result."""
    expression = _expand_shorthand(expression.strip())
    node = parse(expression)
    ctx = _Ctx(rng or random.SystemRandom())
    try:
        value, text = node.eval(ctx)
    except OverflowError as exc:
        raise DiceError("number too large") from exc
    total = _clean(value)
    breakdown = f"{text} = {_fmt(total)}" if text != _fmt(total) else _fmt(total)
    return RollResult(expression, total, breakdown, ctx.groups)


def calculate(expression: str, rng: random.Random | None = None) -> int | float:
    """Evaluate an expression and return just the number."""
    return roll(expression, rng).total


_SHORTHAND = {
    "adv": "2d20kh1",
    "advantage": "2d20kh1",
    "dis": "2d20kl1",
    "disadvantage": "2d20kl1",
    "stats": "4d6dl1",
}


def _expand_shorthand(expression: str) -> str:
    """``adv+5`` -> ``2d20kh1+5``; ``d20 adv`` isn't supported, keep it simple."""

    def sub(m: re.Match) -> str:
        return _SHORTHAND[m.group(0).lower()]

    return re.sub(r"\b(?:advantage|disadvantage|adv|dis|stats)\b", sub, expression, flags=re.IGNORECASE)


def roll_stats(rng: random.Random | None = None) -> list[RollResult]:
    """Roll a standard ability-score array (six sets of 4d6 drop lowest)."""
    rng = rng or random.SystemRandom()
    return [roll("4d6dl1", rng) for _ in range(6)]
