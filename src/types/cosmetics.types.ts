/**
 * Player identity cosmetics: titles, avatars and avatar frames.
 * See migration 1800000000030_player-cosmetics.
 */

export interface TitleInfo {
  title_id: string;
  code_key: string;
  name: string;
  description: string | null;
  accent: string;
}

export interface FrameInfo {
  frame_id: string;
  code_key: string;
  name: string;
  description: string | null;
  sprite_key: string;
  is_unique: boolean;
  /** Owned by everyone; shown when nothing is equipped. */
  is_default?: boolean;
}

export interface AvatarInfo {
  avatar_id: string;
  character_id: string | null;
  character_name: string | null;
  sprite_key: string;
  is_default: boolean;
  /** Card art path (cards/<image_url>), used until the avatar has sprite art. */
  image_url: string | null;
}

/** What other players see: compact, render-only. */
export interface PublicPlayerProfile {
  avatar_sprite_key: string | null;
  avatar_image_url: string | null;
  frame_sprite_key: string | null;
  frame_is_unique: boolean;
  title_name: string | null;
  title_accent: string | null;
}

export interface AvailableCosmetics {
  titles: (TitleInfo & { owned: boolean })[];
  frames: (FrameInfo & {
    owned: boolean;
    /** Unique frames only: username of the current holder, if any. */
    holder_username?: string | null;
  })[];
  avatars: (AvatarInfo & { owned: boolean })[];
  equipped: {
    title_id: string | null;
    frame_id: string | null;
    avatar_id: string | null;
  };
}

export interface EquipCosmeticsInput {
  title_id?: string | null;
  frame_id?: string | null;
  avatar_id?: string | null;
}
