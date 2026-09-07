export interface RcEvent {
  id: string; type: string; app_id?: string; app_user_id?: string;
  product_id?: string; transaction_id?: string; store?: string; environment?: string;
  event_timestamp_ms?: number; purchased_at_ms?: number; price?: number;
  cancel_reason?: string;
  [key: string]: unknown;
}
export interface IapProduct {
  product_id: string; internal_id: string; active: boolean;
  grant_gems: number; grant_card_fragments: number;
  display_name: string; description: string | null; badge: string | null; sort_order: number;
}
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export function parseRcEvent(body: unknown): RcEvent | null {
  const e = (body as any)?.event;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  if (typeof e.id !== 'string' || !e.id.length || e.id.length > 255 || typeof e.type !== 'string' || e.type.length > 100) return null;
  return e;
}
