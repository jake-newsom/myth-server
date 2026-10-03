import { EffectType, InGameCard } from "../types/card.types";
import { MechanicTileEffect } from "../types/battleMechanic.types";
import { BoardPosition } from "../types/game.types";
import { createOrUpdateBuff, createOrUpdateDebuff } from "./ability.utils";

const EFFECT_NAME = "Haunted";

/**
 * True once a haunted bonus has been claimed by the card that consumed the
 * tile. Claimed effects are permanent and are no longer re-derived from the
 * board, so clearing the tile does not strip the bonus. A card keeps a single
 * claimed "Haunted" entry; each further haunted tile it spends stacks onto it.
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
 * Consume a haunted tile: fold the card's pending (tile-derived) haunted bonus
 * into its single claimed "Haunted" effect via createOrUpdateBuff/Debuff, so a
 * card that spends several haunted tiles stacks them on one entry. Reports
 * whether anything was claimed. A card that takes no bonus at all (e.g. an
 * iron-rune card immune to the debuff) still consumes the tile — it walked onto
 * it, so the haunting is spent either way.
 */
export function claimMechanicTileEffect(card: InGameCard, position: BoardPosition): boolean {
  const pending = card.temporary_effects.filter(
    entry => entry.data?.battleMechanic === "haunted" && entry.data?.claimed !== true,
  );
  if (pending.length === 0) return false;

  // Drop the pending entries first: createOrUpdate* matches on name, and they
  // share EFFECT_NAME with the claimed entry the bonus is folded into.
  card.temporary_effects = card.temporary_effects.filter(entry => !pending.includes(entry));
  const data = { battleMechanic: "haunted", claimed: true };
  for (const entry of pending) {
    // Haunted bonuses are uniform across all four sides.
    const amount = entry.power.top ?? 0;
    if (amount > 0) createOrUpdateBuff(card, 1000, amount, EFFECT_NAME, position, data);
    else if (amount < 0) createOrUpdateDebuff(card, 1000, -amount, EFFECT_NAME, position, data);
  }

  // createOrUpdate* creates the entry as a plain Buff/Debuff; keep it a tile
  // bonus so it stays excluded from at-play power (getCardTotalPowerAtPlay),
  // as it was before claiming.
  const claimed = card.temporary_effects.find(isClaimedMechanicEffect);
  if (claimed) claimed.type = EffectType.TilePowerBonus;
  return true;
}
