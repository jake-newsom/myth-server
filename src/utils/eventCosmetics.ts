// myth-server/src/utils/eventCosmetics.ts

/**
 * Border / card back art for a shop slot or milestone rung. Shared by
 * eventShop.service and eventMilestone.service so both surfaces hand the client the same shape.
 * Expects the row to carry the border_* / back_* columns from the joins.
 */
export function cosmeticBorder(row: any, borderId: string | null) {
  return borderId && row.border_image_url
    ? {
        border_id: borderId,
        name: row.border_name,
        image_url: row.border_image_url,
        animation_key: row.border_animation_key ?? null,
      }
    : undefined;
}

export function cosmeticBack(row: any, backId: string | null) {
  return backId && row.back_image_url
    ? { back_id: backId, name: row.back_name, image_url: row.back_image_url }
    : undefined;
}
