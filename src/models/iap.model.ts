import db, { QueryExecutor } from '../config/db.config';
import { RcEvent, IapProduct } from '../types/iap.types';
const field = (s: unknown) => typeof s === 'string' && s.length <= 512 ? s : null;
export const IapModel = {
  async receive(e: RcEvent) {
    await db.query(`INSERT INTO iap_events(event_id,type,app_id,environment,store,transaction_id,app_user_id,product_id,event_timestamp_ms,raw_event)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [e.id,e.type,field(e.app_id),field(e.environment),field(e.store),field(e.transaction_id),field(e.app_user_id),field(e.product_id),
        Number.isSafeInteger(e.event_timestamp_ms) ? e.event_timestamp_ms : null, JSON.stringify(e)]);
  },
  async products(q: QueryExecutor = db): Promise<IapProduct[]> {
    return (await q.query('SELECT * FROM iap_products ORDER BY sort_order, product_id')).rows;
  },
  async catalog(userId: string) {
    return (await db.query(`SELECT p.*,
      EXISTS (SELECT 1 FROM iap_product_ownership o WHERE o.user_id=$1 AND o.product_id=p.product_id) AS owned,
      EXISTS (SELECT 1 FROM iap_blessings b WHERE b.user_id=$1 AND b.status='active' AND b.expires_at > now()) AS blessing_active
      FROM iap_products p WHERE p.active AND EXISTS
      (SELECT 1 FROM users WHERE user_id=$1 AND banned_at IS NULL AND iap_blocked_at IS NULL) ORDER BY sort_order`, [userId])).rows as IapProduct[];
  },
  async status(userId: string, transactionId: string, store: string) {
    return (await db.query(`SELECT status, store_transaction_id AS transaction_id FROM iap_purchases
      WHERE user_id=$1 AND store_transaction_id=$2 AND store=$3 ORDER BY created_at DESC LIMIT 1`, [userId, transactionId, store])).rows[0] || { status: 'pending' };
  },
  async scrubUser(q: QueryExecutor, userId: string) {
    // Keep store transaction tombstones, but remove RC identity/attributes from retained payloads.
    await q.query(`UPDATE iap_events SET app_user_id=NULL, raw_event=jsonb_build_object('redacted', true)
      WHERE app_user_id=$1 OR raw_event->>'original_app_user_id'=$1 OR raw_event->'aliases' ? $1
      OR raw_event->'transferred_from' ? $1 OR raw_event->'transferred_to' ? $1`, [userId]);
  },
};
