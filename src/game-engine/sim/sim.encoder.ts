import { GameState, TileStatus, TileTerrain } from "../../types/game.types";
import { InGameCard } from "../../types/card.types";
import * as validators from "../game.validators";
import { DeckPool } from "./sim.types";

/**
 * Fixed-size numeric encoding of a game state from ONE player's perspective,
 * for the learned value/policy network. Hidden information is respected: the
 * opponent's hand and deck are only visible as an aggregate "unseen pool".
 *
 * Bump ENCODER_VERSION whenever any layout below changes — training data and
 * model weights are only valid for the version they were produced with.
 */
export const ENCODER_VERSION = 1;

export const BOARD_TILES = 16;
export const HAND_SLOTS = 10;
export const TILE_FEATURES = 22;
export const HAND_FEATURES = 9;

/** Index 0 = none/empty, 1 = unknown (not in vocab). */
export interface EncoderVocab {
  version: number;
  abilities: string[];
  characters: string[];
  tags: string[];
}

export interface EncodedState {
  /** BOARD_TILES × TILE_FEATURES, row-major. */
  tiles: number[];
  tileAbility: number[];
  tileCharacter: number[];
  /** HAND_SLOTS × HAND_FEATURES for the perspective player's own hand. */
  hand: number[];
  handAbility: number[];
  handCharacter: number[];
  scalars: number[];
  /** Count of each ability among the opponent's unseen cards (hand + deck). */
  oppUnseenAbilities: number[];
  /** Same, for the perspective player's own remaining deck. */
  myDeckAbilities: number[];
}

const VOCAB_OFFSET = 2;

export function buildVocab(pool: DeckPool): EncoderVocab {
  const abilities = new Set<string>();
  const characters = new Set<string>();
  const tags = new Set<string>();
  for (const deck of pool.decks) {
    for (const card of deck.cards) {
      const id = abilityId(card);
      if (id) abilities.add(id);
      characters.add(card.base_card_data.name);
      for (const t of card.base_card_data.tags ?? []) tags.add(t);
    }
  }
  return {
    version: ENCODER_VERSION,
    abilities: [...abilities].sort(),
    characters: [...characters].sort(),
    tags: [...tags].sort(),
  };
}

function abilityId(card: InGameCard): string | null {
  const sa = card.base_card_data.special_ability;
  return sa ? sa.id ?? sa.ability_id ?? null : null;
}

export class StateEncoder {
  private readonly abilityIndex: Map<string, number>;
  private readonly characterIndex: Map<string, number>;
  private readonly tagIndex: Map<string, number>;
  /**
   * Characters/abilities seen that aren't in the vocab (encoded as "unknown").
   * Non-empty means cards shipped after the model was trained — retrain.
   */
  readonly unknown = new Set<string>();

  constructor(readonly vocab: EncoderVocab) {
    this.abilityIndex = new Map(
      vocab.abilities.map((a, i) => [a, i + VOCAB_OFFSET])
    );
    this.characterIndex = new Map(
      vocab.characters.map((c, i) => [c, i + VOCAB_OFFSET])
    );
    this.tagIndex = new Map(vocab.tags.map((t, i) => [t, i]));
  }

  get abilityVocabSize() {
    return this.vocab.abilities.length + VOCAB_OFFSET;
  }

  get characterVocabSize() {
    return this.vocab.characters.length + VOCAB_OFFSET;
  }

  get scalarCount() {
    return 17 + this.vocab.tags.length;
  }

  private ability(card: InGameCard | null | undefined): number {
    if (!card) return 0;
    const id = abilityId(card);
    if (!id) return 0;
    const index = this.abilityIndex.get(id);
    if (index === undefined) this.unknown.add(`ability:${id}`);
    return index ?? 1;
  }

  private character(card: InGameCard | null | undefined): number {
    if (!card) return 0;
    const index = this.characterIndex.get(card.base_card_data.name);
    if (index === undefined) this.unknown.add(`character:${card.base_card_data.name}`);
    return index ?? 1;
  }

  private abilityBag(state: GameState, ids: string[]): number[] {
    const bag = new Array(this.abilityVocabSize).fill(0);
    for (const id of ids) {
      bag[this.ability(state.hydrated_card_data_cache?.[id])] += 1;
    }
    return bag;
  }

  encode(state: GameState, perspectiveId: string): EncodedState {
    const me = validators.getPlayer(state, perspectiveId);
    const opp =
      state.player1.user_id === perspectiveId ? state.player2 : state.player1;
    const cache = state.hydrated_card_data_cache ?? {};

    const tiles: number[] = [];
    const tileAbility: number[] = [];
    const tileCharacter: number[] = [];
    let mine = 0;
    let theirs = 0;
    let playable = 0;
    const myTags = new Array(this.vocab.tags.length).fill(0);

    for (let y = 0; y < state.board.length; y++) {
      for (let x = 0; x < state.board[y].length; x++) {
        const cell = state.board[y][x];
        const card = cell.card;
        const effect = cell.tile_effect;
        const status = effect?.status;
        const tilePower = effect?.power
          ? (effect.power.top ?? 0) +
            (effect.power.right ?? 0) +
            (effect.power.bottom ?? 0) +
            (effect.power.left ?? 0)
          : 0;
        const isMine = card ? card.owner === perspectiveId : false;
        if (card) {
          if (isMine) {
            mine++;
            for (const t of card.base_card_data.tags ?? []) {
              const i = this.tagIndex.get(t);
              if (i !== undefined) myTags[i] += 1 / BOARD_TILES;
            }
          } else theirs++;
        } else if (validators.canPlaceOnTile(state, { x, y }).canPlace) {
          playable++;
        }
        const cp = card?.current_power;
        const bp = card?.base_card_data.base_power;
        tiles.push(
          card ? 1 : 0,
          card && isMine ? 1 : 0,
          card && !isMine ? 1 : 0,
          (cp?.top ?? 0) / 10,
          (cp?.right ?? 0) / 10,
          (cp?.bottom ?? 0) / 10,
          (cp?.left ?? 0) / 10,
          (bp?.top ?? 0) / 10,
          (bp?.right ?? 0) / 10,
          (bp?.bottom ?? 0) / 10,
          (bp?.left ?? 0) / 10,
          cell.tile_enabled ? 1 : 0,
          status === TileStatus.Blocked ? 1 : 0,
          status === TileStatus.Removed ? 1 : 0,
          status === TileStatus.Boosted ? 1 : 0,
          status === TileStatus.Cursed ? 1 : 0,
          effect?.terrain === TileTerrain.Ocean ? 1 : 0,
          effect?.terrain === TileTerrain.Lava ? 1 : 0,
          Math.min(effect?.turns_left ?? 0, 10) / 5,
          tilePower / 5,
          card && card.lockedTurns > 0 ? 1 : 0,
          card && card.owner !== card.original_owner ? 1 : 0
        );
        tileAbility.push(this.ability(card));
        tileCharacter.push(this.character(card));
      }
    }

    const hand: number[] = [];
    const handAbility: number[] = [];
    const handCharacter: number[] = [];
    for (let i = 0; i < HAND_SLOTS; i++) {
      const card = cache[me.hand[i]] ?? null;
      const cp = card?.current_power;
      const bp = card?.base_card_data.base_power;
      hand.push(
        card ? 1 : 0,
        (cp?.top ?? 0) / 10,
        (cp?.right ?? 0) / 10,
        (cp?.bottom ?? 0) / 10,
        (cp?.left ?? 0) / 10,
        (bp?.top ?? 0) / 10,
        (bp?.right ?? 0) / 10,
        (bp?.bottom ?? 0) / 10,
        (bp?.left ?? 0) / 10
      );
      handAbility.push(this.ability(card));
      handCharacter.push(this.character(card));
    }

    const unseen = [...opp.hand, ...opp.deck];
    const avgPower = (ids: string[]) => {
      if (!ids.length) return 0;
      let sum = 0;
      for (const id of ids) {
        const p = cache[id]?.current_power;
        if (p) sum += p.top + p.right + p.bottom + p.left;
      }
      return sum / ids.length / 40;
    };
    const effectOneHot = (e: string | null | undefined) => [
      e === "norse" ? 1 : 0,
      e === "polynesian" ? 1 : 0,
      e === "japanese" ? 1 : 0,
    ];

    const scalars = [
      Math.min(state.turn_number, 40) / 20,
      mine / BOARD_TILES,
      theirs / BOARD_TILES,
      playable / BOARD_TILES,
      me.hand.length / HAND_SLOTS,
      opp.hand.length / HAND_SLOTS,
      me.deck.length / 20,
      opp.deck.length / 20,
      avgPower(me.deck),
      avgPower(unseen),
      Math.min(state.consecutive_passes ?? 0, 2) / 2,
      ...effectOneHot(me.deck_effect),
      ...effectOneHot(opp.deck_effect),
      ...myTags,
    ];

    return {
      tiles,
      tileAbility,
      tileCharacter,
      hand,
      handAbility,
      handCharacter,
      scalars,
      oppUnseenAbilities: this.abilityBag(state, unseen),
      myDeckAbilities: this.abilityBag(state, me.deck),
    };
  }
}
