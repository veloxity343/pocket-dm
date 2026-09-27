// Mirrors src/pocket_dm/schemas.py.

export type Kind = "campaigns" | "sessions" | "characters" | "handbook";

export interface RecordBase {
  id: string;
  created: string;
  updated: string;
}

export interface Player {
  name: string;
  contact: string;
  character_id: string;
  notes: string;
}

export interface Campaign extends RecordBase {
  name: string;
  system: string;
  description: string;
  setting: string;
  players: Player[];
  notes: string;
}

export type CombatantKind = "monster" | "pc" | "npc";

export interface Combatant {
  id: string;
  name: string;
  kind: CombatantKind;
  initiative: number;
  init_bonus: number;
  ac: number;
  hp: number;
  max_hp: number;
  temp_hp: number;
  conditions: string[];
  notes: string;
  character_id: string;
  srd_id: string;
  xp: number;
  hidden: boolean;
}

export interface Encounter {
  round: number;
  turn: number;
  active: boolean;
  combatants: Combatant[];
}

export interface LogEntry {
  id: string;
  time: string;
  kind: string;
  text: string;
}

export interface LootItem {
  name: string;
  qty: number;
  value: string;
  assigned_to: string;
}

export type SessionStatus = "planned" | "active" | "done";

export interface Session extends RecordBase {
  campaign_id: string;
  number: number;
  title: string;
  date: string;
  status: SessionStatus;
  attendance: string[];
  prep: string;
  recap: string;
  log: LogEntry[];
  encounter: Encounter;
  loot: LootItem[];
  xp_awarded: number;
}

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type SkillProficiency = "none" | "half" | "proficient" | "expertise";

export interface ClassLevel {
  name: string;
  subclass: string;
  level: number;
}

export interface Attack {
  name: string;
  bonus: string;
  damage: string;
  notes: string;
}

export interface SpellSlot {
  max: number;
  used: number;
}

export interface Spell {
  name: string;
  level: number;
  prepared: boolean;
  notes: string;
  srd_id: string;
}

export interface Resource {
  name: string;
  current: number;
  max: number;
  reset: "long" | "short" | "none";
}

export interface Item {
  name: string;
  qty: number;
  weight: number;
  equipped: boolean;
  notes: string;
}

export interface Feature {
  name: string;
  source: string;
  description: string;
}

export type Coin = "cp" | "sp" | "ep" | "gp" | "pp";

export interface Character extends RecordBase {
  name: string;
  player: string;
  campaign_id: string;
  race: string;
  background: string;
  alignment: string;
  classes: ClassLevel[];
  xp: number;
  abilities: Record<Ability, number>;
  save_proficiencies: Ability[];
  skills: Record<string, SkillProficiency>;
  jack_of_all_trades: boolean;
  ac: number;
  initiative_misc: number;
  speed: number;
  hp: { max: number; current: number; temp: number };
  hit_dice: { total: string; remaining: number };
  death_saves: { successes: number; failures: number };
  inspiration: boolean;
  conditions: string[];
  exhaustion: number;
  proficiencies: { armor: string; weapons: string; tools: string; languages: string };
  attacks: Attack[];
  spellcasting: { ability: string; slots: Record<string, SpellSlot>; spells: Spell[] };
  resources: Resource[];
  inventory: Item[];
  currency: Record<Coin, number>;
  features: Feature[];
  personality: { traits: string; ideals: string; bonds: string; flaws: string };
  appearance: string;
  backstory: string;
  notes: string;
}

export interface HandbookEntry extends RecordBase {
  title: string;
  category: string;
  tags: string[];
  campaign_id: string;
  body: string;
}

export interface KindMap {
  campaigns: Campaign;
  sessions: Session;
  characters: Character;
  handbook: HandbookEntry;
}

export interface RollResult {
  expression: string;
  total: number;
  breakdown: string;
  groups: unknown[];
  critical: boolean;
  fumble: boolean;
}

export interface RollEntry extends RollResult {
  label: string;
  time: string;
}

export interface SrdEntry {
  id: string;
  name: string;
  category: string;
  summary: string;
  tags: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
  body?: string;
}

export interface SrdCategory {
  id: string;
  label: string;
  count: number;
}

export interface SrdMeta {
  attribution: string;
  source: string;
}

export interface Meta {
  version: string;
  data_dir: string;
  database: string;
  srd: SrdMeta;
  abilities: Record<Ability, string>;
  skills: Record<string, Ability>;
  conditions: string[];
  hit_dice: Record<string, number>;
  xp_by_level: number[];
  cr_xp: Record<string, number>;
  spell_slots: number[][];
  point_buy: { cost: Record<string, number>; budget: number };
  standard_array: number[];
}

export interface ImportSummary {
  imported: Partial<Record<Kind, number>>;
  skipped: Partial<Record<Kind, number>>;
  mode: string;
}

export type EncounterAction =
  | { action: "add"; combatant: Partial<Combatant> }
  | { action: "add_monster"; srd_id: string; count?: number; average_hp?: boolean }
  | { action: "add_character"; character_ids: string[] }
  | { action: "update"; id: string; changes: Partial<Combatant> }
  | { action: "remove"; id: string }
  | { action: "hp"; id: string; amount: number }
  | { action: "roll_initiative"; which: "all" | "monsters" | "unset" }
  | { action: "sort" | "next" | "prev" | "end" }
  | { action: "clear"; all?: boolean };
