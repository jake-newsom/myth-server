import type { PoolClient } from "pg";
import {
  AdminDbProfile,
  queryForProfile,
  withTransaction,
} from "./admin-db";

export type CloneCardsResult = {
  charactersInserted: number;
  charactersUpdated: number;
  variantsInserted: number;
  variantsUpdated: number;
  warnings: string[];
};

type SourceCharacterRow = {
  character_id: string;
  name: string;
  description: string | null;
  type: string;
  base_power: { top: number; right: number; bottom: number; left: number };
  special_ability_id: string | null;
  set_id: string | null;
  tags: string[];
  set_name: string | null;
  ability_slug: string | null;
};

type SourceVariantRow = {
  card_variant_id: string;
  character_id: string;
  rarity: string;
  image_url: string;
  attack_animation: string | null;
  is_exclusive: boolean;
};

function normalizeBasePower(bp: unknown): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const o = bp as Record<string, unknown>;
  return {
    top: Number(o?.top ?? 0),
    right: Number(o?.right ?? 0),
    bottom: Number(o?.bottom ?? 0),
    left: Number(o?.left ?? 0),
  };
}

async function mapDestFk(
  client: PoolClient,
  setName: string | null | undefined,
  abilitySlug: string | null | undefined,
  charName: string,
  warnings: string[]
): Promise<{ set_id: string | null; special_ability_id: string | null }> {
  let set_id: string | null = null;
  if (setName && String(setName).trim()) {
    const r = await client.query(`SELECT set_id FROM "sets" WHERE name = $1`, [
      setName.trim(),
    ]);
    set_id = r.rows[0]?.set_id ?? null;
    if (!set_id) {
      warnings.push(
        `Destination has no set named "${setName}" — ${charName} will have set_id null.`
      );
    }
  }

  let special_ability_id: string | null = null;
  if (abilitySlug && String(abilitySlug).trim()) {
    const r = await client.query(
      `SELECT ability_id FROM special_abilities WHERE id = $1`,
      [abilitySlug.trim()]
    );
    special_ability_id = r.rows[0]?.ability_id ?? null;
    if (!special_ability_id) {
      warnings.push(
        `Destination has no special_ability id "${abilitySlug}" — ${charName} will have ability cleared.`
      );
    }
  }

  return { set_id, special_ability_id };
}

/**
 * Copies character + variant definitions from `from` to `to`.
 * Matches existing destination rows by character name and variant rarity (merge / upsert).
 * Maps set_id and special_ability_id using set name and special_abilities.id (slug).
 */
export async function cloneCharactersBetweenProfiles(
  from: AdminDbProfile,
  to: AdminDbProfile,
  options: { characterNames?: string[] | null }
): Promise<CloneCardsResult> {
  const warnings: string[] = [];
  let charactersInserted = 0;
  let charactersUpdated = 0;
  let variantsInserted = 0;
  let variantsUpdated = 0;

  const nameFilter = options.characterNames?.length
    ? options.characterNames.map((n) => n.trim()).filter(Boolean)
    : null;

  const charBase = `
    SELECT
      ch.character_id, ch.name, ch.description, ch.type,
      ch.base_power, ch.special_ability_id, ch.set_id, ch.tags,
      s.name AS set_name,
      sa.id AS ability_slug
    FROM characters ch
    LEFT JOIN "sets" s ON s.set_id = ch.set_id
    LEFT JOIN special_abilities sa ON sa.ability_id = ch.special_ability_id
  `;

  const charRes =
    nameFilter && nameFilter.length > 0
      ? await queryForProfile(
          from,
          charBase + ` WHERE ch.name = ANY($1::text[]) ORDER BY ch.name`,
          [nameFilter]
        )
      : await queryForProfile(from, charBase + ` ORDER BY ch.name`);

  const sourceChars: SourceCharacterRow[] = charRes.rows.map((row) => ({
    character_id: row.character_id,
    name: row.name,
    description: row.description,
    type: row.type,
    base_power: normalizeBasePower(row.base_power),
    special_ability_id: row.special_ability_id,
    set_id: row.set_id,
    tags: row.tags || [],
    set_name: row.set_name,
    ability_slug: row.ability_slug,
  }));

  const charIds = sourceChars.map((c) => c.character_id);
  if (charIds.length === 0) {
    return {
      charactersInserted: 0,
      charactersUpdated: 0,
      variantsInserted: 0,
      variantsUpdated: 0,
      warnings: ["No characters matched in the source database."],
    };
  }

  const varRes = await queryForProfile(
    from,
    `
    SELECT card_variant_id, character_id, rarity, image_url, attack_animation,
           COALESCE(is_exclusive, false) AS is_exclusive
    FROM card_variants
    WHERE character_id = ANY($1::uuid[])
    ORDER BY character_id, rarity
  `,
    [charIds]
  );

  const variantsByCharacter = new Map<string, SourceVariantRow[]>();
  for (const row of varRes.rows) {
    const cid = row.character_id as string;
    if (!variantsByCharacter.has(cid)) variantsByCharacter.set(cid, []);
    variantsByCharacter.get(cid)!.push({
      card_variant_id: row.card_variant_id,
      character_id: cid,
      rarity: row.rarity,
      image_url: row.image_url,
      attack_animation: row.attack_animation,
      is_exclusive: Boolean(row.is_exclusive),
    });
  }

  for (const ch of sourceChars) {
    await withTransaction(to, async (client) => {
      const { set_id: destSetId, special_ability_id: destAbilityId } =
        await mapDestFk(
          client,
          ch.set_name,
          ch.ability_slug,
          ch.name,
          warnings
        );

      const bpJson = JSON.stringify(ch.base_power);

      const existing = await client.query(
        `SELECT character_id FROM characters WHERE name = $1 ORDER BY created_at ASC LIMIT 1`,
        [ch.name]
      );

      let destCharacterId: string;

      if (existing.rows[0]) {
        destCharacterId = existing.rows[0].character_id;
        await client.query(
          `
          UPDATE characters
          SET description = $2, type = $3, base_power = $4::jsonb,
              special_ability_id = $5, set_id = $6, tags = $7, updated_at = NOW()
          WHERE character_id = $1
        `,
          [
            destCharacterId,
            ch.description,
            ch.type,
            bpJson,
            destAbilityId,
            destSetId,
            ch.tags,
          ]
        );
        charactersUpdated++;
      } else {
        const ins = await client.query(
          `
          INSERT INTO characters (name, description, type, base_power, special_ability_id, set_id, tags)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
          RETURNING character_id
        `,
          [
            ch.name,
            ch.description,
            ch.type,
            bpJson,
            destAbilityId,
            destSetId,
            ch.tags,
          ]
        );
        destCharacterId = ins.rows[0].character_id;
        charactersInserted++;
      }

      const variants = variantsByCharacter.get(ch.character_id) || [];
      for (const v of variants) {
        const ex = await client.query(
          `
          SELECT card_variant_id FROM card_variants
          WHERE character_id = $1 AND rarity = $2
        `,
          [destCharacterId, v.rarity]
        );

        if (ex.rows[0]) {
          await client.query(
            `
            UPDATE card_variants
            SET image_url = $2, attack_animation = $3, is_exclusive = $4
            WHERE card_variant_id = $1
          `,
            [
              ex.rows[0].card_variant_id,
              v.image_url,
              v.attack_animation,
              v.is_exclusive,
            ]
          );
          variantsUpdated++;
        } else {
          await client.query(
            `
            INSERT INTO card_variants (character_id, rarity, image_url, attack_animation, is_exclusive)
            VALUES ($1, $2, $3, $4, $5)
          `,
            [
              destCharacterId,
              v.rarity,
              v.image_url,
              v.attack_animation,
              v.is_exclusive,
            ]
          );
          variantsInserted++;
        }
      }
    });
  }

  return {
    charactersInserted,
    charactersUpdated,
    variantsInserted,
    variantsUpdated,
    warnings,
  };
}
