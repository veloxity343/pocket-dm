// Mirrors pocket_dm.rules.derive so the sheet can update as you type.

import type { Ability, Character, Meta } from "../types";
import { ABILITIES, modOf, profBonus } from "./util";

export interface Derived {
  level: number;
  pb: number;
  mods: Record<Ability, number>;
  saves: Record<Ability, number>;
  skills: Record<string, number>;
  initiative: number;
  passive: { perception: number; investigation: number; insight: number };
  spell: { dc: number; atk: number } | null;
}

export function totalLevel(ch: Character) {
  return ch.classes.reduce((a, c) => a + (Number(c.level) || 0), 0) || 1;
}

export function derive(ch: Character, meta: Meta | null): Derived {
  const level = totalLevel(ch);
  const pb = profBonus(level);
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, modOf(ch.abilities[a])])) as Record<Ability, number>;
  const saves = Object.fromEntries(
    ABILITIES.map((a) => [a, mods[a] + (ch.save_proficiencies.includes(a) ? pb : 0)]),
  ) as Record<Ability, number>;
  const skills: Record<string, number> = {};
  for (const [skill, ab] of Object.entries(meta?.skills || {})) {
    const p = ch.skills[skill] || "none";
    const bonus = p === "expertise" ? pb * 2 : p === "proficient" ? pb : p === "half" || ch.jack_of_all_trades ? Math.floor(pb / 2) : 0;
    skills[skill] = mods[ab] + bonus;
  }
  const sa = ch.spellcasting.ability as Ability;
  return {
    level,
    pb,
    mods,
    saves,
    skills,
    initiative: mods.dex + (Number(ch.initiative_misc) || 0),
    passive: {
      perception: 10 + (skills.perception ?? 0),
      investigation: 10 + (skills.investigation ?? 0),
      insight: 10 + (skills.insight ?? 0),
    },
    spell: sa && mods[sa] !== undefined ? { dc: 8 + pb + mods[sa], atk: pb + mods[sa] } : null,
  };
}
