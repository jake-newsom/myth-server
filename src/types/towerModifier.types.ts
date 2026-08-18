/**
 * Tower Encounter Modifiers.
 *
 * Every 5th floor past 100 can carry up to 2 modifiers. They come in two
 * families:
 *   - deck restrictions  — checked once, at POST /tower/start, before a game
 *                          record exists. A violating deck is rejected outright.
 *   - statuses           — carried in game_state.tower_context and applied by the
 *                          engine during the battle.
 *
 * Design notes:
 *  - `label`/`description` are stored on the row rather than derived from `type`,
 *    so a client that predates a modifier type can still render it, and copy can
 *    be retuned without an app release.
 *  - At most one deck restriction per floor. That is an authoring rule (enforced
 *    by scripts/assign-tower-modifiers.js), not a runtime guarantee: stacking two
 *    restrictions is what risks walling a collection, while any single one is
 *    comfortably satisfiable (each set alone offers 60+ legal cards against a
 *    20-card deck).
 */

import { Rarity, RarityUtils } from "./card.types";

export type TowerModifierType =
  | "max_budget"
  | "single_set"
  | "no_tag"
  | "no_legendary"
  | "poison";

/** Modifier types checked against the player's deck before the game starts. */
export const DECK_RESTRICTION_TYPES: readonly TowerModifierType[] = [
  "max_budget",
  "single_set",
  "no_tag",
  "no_legendary",
] as const;

/** Modifier types applied by the engine during the battle. */
export const STATUS_TYPES: readonly TowerModifierType[] = ["poison"] as const;

export const ALL_MODIFIER_TYPES: readonly TowerModifierType[] = [
  ...DECK_RESTRICTION_TYPES,
  ...STATUS_TYPES,
] as const;

export interface TowerModifier {
  type: TowerModifierType;
  /** 33 for max_budget, "norse" for single_set, "ice" for no_tag, 1 for poison. */
  value?: number | string;
  /** Display name, e.g. "Frugal Ascent". Authored, not derived. */
  label: string;
  /** One-line player-facing explanation. Authored, not derived. */
  description: string;
  /** Optional icon hint for the client (UIIcon or card-tag name). */
  icon?: string;
}

/** Tower-specific battle context, mirrored on GameState like saga_context. */
export interface TowerBattleContext {
  floor_number: number;
  modifiers: TowerModifier[];
}

export const MAX_MODIFIERS_PER_FLOOR = 2;

/** The three released sets, lowercased, as used by single_set. */
export const MODIFIER_SET_SLUGS = ["norse", "japanese", "polynesian"] as const;

/**
 * Tags eligible for `no_tag`.
 *
 * Deliberately excludes the two broadest tags (god: 31 characters, human: 29 of
 * 91) — banning either leaves too thin a pool to build around. Everything here
 * covers at most ~20 characters, so a ban still leaves 70+ to choose from.
 */
export const NO_TAG_ELIGIBLE = [
  "war",
  "sea",
  "mystic",
  "spirit",
  "nature",
  "trickster",
  "sky",
  "beast",
  "dragon",
  "underworld",
  "fire",
  "ice",
  "demon",
  "giant",
] as const;

export function isDeckRestriction(modifier: TowerModifier): boolean {
  return DECK_RESTRICTION_TYPES.includes(modifier.type);
}

export function isStatusModifier(modifier: TowerModifier): boolean {
  return STATUS_TYPES.includes(modifier.type);
}

/**
 * A floor's modifiers, normalized.
 *
 * The column is JSONB written by scripts and by LLM-assisted generation, so it is
 * treated as untrusted: anything that is not a well-formed known modifier is
 * dropped rather than allowed to throw at game start. Also caps the list, so a
 * bad write can never present more than MAX_MODIFIERS_PER_FLOOR to the player.
 */
export function normalizeModifiers(raw: unknown): TowerModifier[] {
  if (!Array.isArray(raw)) return [];

  const valid = raw.filter((entry): entry is TowerModifier => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Partial<TowerModifier>;
    return (
      typeof candidate.type === "string" &&
      ALL_MODIFIER_TYPES.includes(candidate.type as TowerModifierType) &&
      typeof candidate.label === "string" &&
      typeof candidate.description === "string"
    );
  });

  return valid.slice(0, MAX_MODIFIERS_PER_FLOOR);
}

/**
 * Thrown when a deck violates a floor's Encounter Modifiers.
 *
 * Carries the per-modifier violation list so the controller can return it as a
 * structured field instead of the client having to split a sentence apart.
 */
export class TowerModifierViolationError extends Error {
  readonly violations: string[];

  constructor(violations: string[]) {
    super(`Encounter modifier: ${violations.join(" ")}`);
    this.name = "TowerModifierViolationError";
    this.violations = violations;
  }
}

/** Minimal card shape needed to validate a deck. */
export interface ModifierDeckCard {
  name: string;
  rarity: Rarity;
  tags: string[];
  set_name: string | null;
}

/**
 * Check a deck against a floor's modifiers.
 *
 * Pure and DB-free so it can be unit tested directly. Returns one
 * player-readable sentence per violated modifier; an empty array means legal.
 */
export function validateDeckAgainstModifiers(
  cards: ModifierDeckCard[],
  modifiers: TowerModifier[]
): string[] {
  const violations: string[] = [];

  for (const modifier of modifiers) {
    switch (modifier.type) {
      case "max_budget": {
        const cap = Number(modifier.value);
        if (!Number.isFinite(cap)) break;
        const spent = cards.reduce(
          (total, card) => total + RarityUtils.getPowerCost(card.rarity),
          0
        );
        if (spent > cap) {
          violations.push(
            `${modifier.label}: this floor caps the deck power budget at ${cap}. Your deck spends ${spent}.`
          );
        }
        break;
      }

      case "single_set": {
        const required = String(modifier.value ?? "").toLowerCase();
        if (!required) break;
        const offenders = cards.filter(
          (card) => (card.set_name ?? "").toLowerCase() !== required
        );
        if (offenders.length > 0) {
          violations.push(
            `${modifier.label}: only ${titleCase(required)} cards may enter this floor. ${describeOffenders(offenders)}`
          );
        }
        break;
      }

      case "no_tag": {
        const banned = String(modifier.value ?? "").toLowerCase();
        if (!banned) break;
        const offenders = cards.filter((card) =>
          (card.tags ?? []).some((tag) => tag.toLowerCase() === banned)
        );
        if (offenders.length > 0) {
          violations.push(
            `${modifier.label}: ${titleCase(banned)} cards may not enter this floor. ${describeOffenders(offenders)}`
          );
        }
        break;
      }

      case "no_legendary": {
        const offenders = cards.filter((card) =>
          RarityUtils.isLegendary(card.rarity)
        );
        if (offenders.length > 0) {
          violations.push(
            `${modifier.label}: Legendary cards may not enter this floor. ${describeOffenders(offenders)}`
          );
        }
        break;
      }

      default:
        // Statuses (poison) are applied in-battle, not validated here.
        break;
    }
  }

  return violations;
}

/**
 * "3 cards must be swapped: Odin, Thor ×2." — the count is of CARDS, while the
 * list is of distinct NAMES, so repeated cards are annotated with ×N. Without
 * that, a deck holding two copies of one card reads as
 * "2 cards must be swapped: Odin", which looks like a bug to the player.
 */
function describeOffenders(offenders: ModifierDeckCard[]): string {
  const countsByName = new Map<string, number>();
  for (const card of offenders) {
    countsByName.set(card.name, (countsByName.get(card.name) ?? 0) + 1);
  }

  const names = [...countsByName.entries()].map(([name, count]) =>
    count > 1 ? `${name} ×${count}` : name
  );
  const shown = names.slice(0, 5).join(", ");
  const overflow = names.length > 5 ? `, +${names.length - 5} more` : "";
  const total = offenders.length;
  return `${total} card${total === 1 ? "" : "s"} must be swapped: ${shown}${overflow}.`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
