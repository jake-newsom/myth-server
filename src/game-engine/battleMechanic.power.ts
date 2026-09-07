import { EffectType, InGameCard } from "../types/card.types";
import { MechanicTileEffect } from "../types/battleMechanic.types";

const EFFECT_NAME = "Haunted";

/**
 * True once a haunted bonus has been claimed by the card that consumed the
 * tile. Claimed effects are permanent and are no longer re-derived from the
 * board, so clearing the tile does not strip the bonus.
 */
export function isClaimedMechanicEffect(entry: { data?: Record<string, unknown> }): boolean {
  return entry.data?.battleMechanic === "haunted" && entry.data?.claimed === true;
}

export function refreshMechanicTilePower(card: InGameCard, effect?: MechanicTileEffect): void {
  // Only tile-derived (unclaimed) entries are recomputed; a claimed bonus
  // belongs to the card now and survives the tile being cleared.
  card.temporary_effects = card.temporary_effects.filter(
    entry => entry.data?.battleMechanic !== "haunted" || isClaimedMechanicEffect(entry),
  );
  if (!effect) return;
  if (card.temporary_effects.some(isClaimedMechanicEffect)) return;
  const amount = card.base_card_data.tags?.includes(effect.tag) ? effect.matching_bonus : effect.other_bonus;
  if (amount < 0 && card.saga_rune_type === "iron") return;
  card.temporary_effects.push({
    type: EffectType.TilePowerBonus,
    name: EFFECT_NAME,
    duration: 1000,
    power: { top: amount, right: amount, bottom: amount, left: amount },
    data: { battleMechanic: "haunted" },
  });
}

/**
 * Consume a haunted tile: bake the card's current haunted bonus in permanently
 * and report whether the tile should now be cleared. A card that takes no
 * bonus at all (e.g. an iron-rune card immune to the debuff) still consumes
 * the tile — it walked onto it, so the haunting is spent either way.
 */
export function claimMechanicTileEffect(card: InGameCard): boolean {
  let claimedAny = false;
  for (const entry of card.temporary_effects) {
    if (entry.data?.battleMechanic === "haunted" && entry.data?.claimed !== true) {
      entry.data = { ...entry.data, claimed: true };
      claimedAny = true;
    }
  }
  return claimedAny;
}
