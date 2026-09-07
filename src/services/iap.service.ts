import db from '../config/db.config';
import { IapModel } from '../models/iap.model';
import { iapConfig } from '../config/iap.config';
import { isUuid } from '../types/iap.types';
import FeatureFlagService from './featureFlag.service';
import { SHOP_CONFIG } from '../config/constants';
import { cacheInvalidation } from './cache.invalidation.service';

const PURCHASE = 'NON_RENEWING_PURCHASE';
const REFUND = 'CANCELLATION';
const REVERSED = 'REFUND_REVERSED';

export const IapService = {
  async catalog(userId: string) {
    if (!iapConfig().enabled || !await FeatureFlagService.isEnabled(userId, SHOP_CONFIG.IAP_FLAG)) return [];
    return IapModel.catalog(userId);
  },
  // Receipt persistence commits before processing, so errors can be retried by RC or an operator.
  async process(eventId: string): Promise<string> {
    const c = await db.getClient();
    let changedUser: string | undefined;
    try {
      await c.query('BEGIN');
      const { rows: [initial] } = await c.query('SELECT * FROM iap_events WHERE event_id=$1', [eventId]);
      if (!initial) throw new Error('Event not found');
      const key = [initial.app_id, initial.environment, initial.store, initial.transaction_id || eventId].join(':');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      const { rows: [e] } = await c.query('SELECT * FROM iap_events WHERE event_id=$1', [eventId]);
      const finish = async (state: string, issue: string | null = null) => {
        await c.query('UPDATE iap_events SET state=$2,issue=$3,processed_at=now() WHERE event_id=$1', [eventId,state,issue]);
        await c.query('COMMIT');
        return state;
      };
      if (e.state === 'processed' || e.state === 'ignored') return await finish(e.state);
      if (e.type === 'TEST' || e.type === 'TRANSFER') return await finish('ignored'); // Currency belongs to original grant recipient.
      if (![PURCHASE, REFUND, REVERSED].includes(e.type)) return await finish('review', 'unsupported_event');
      const cfg = iapConfig();
      if (!cfg.appIds.includes(e.app_id) || e.environment !== cfg.environment || !['APP_STORE','PLAY_STORE'].includes(e.store)) {
        return await finish('review', 'unexpected_app_store_or_environment');
      }
      if (!e.transaction_id || !e.product_id || !Number.isSafeInteger(Number(e.event_timestamp_ms)) || Number(e.event_timestamp_ms) <= 0) {
        return await finish('review', 'invalid_money_event');
      }
      const args = [e.app_id,e.environment,e.store,e.transaction_id];
      let { rows: [p] } = await c.query(`SELECT * FROM iap_purchases WHERE app_id=$1 AND environment=$2 AND store=$3 AND store_transaction_id=$4`, args);
      if (!p) {
        // Use original purchase event for identity and product. A refund can arrive first.
        const { rows: [purchase] } = await c.query(`SELECT * FROM iap_events WHERE app_id=$1 AND environment=$2 AND store=$3 AND transaction_id=$4
          AND type='NON_RENEWING_PURCHASE' ORDER BY received_at LIMIT 1`, args);
        if (!purchase) return await finish('review', 'awaiting_purchase');
        if (!isUuid(purchase.app_user_id)) return await finish('review', 'unknown_identity');
        const { rows: [user] } = await c.query('SELECT user_id FROM users WHERE user_id=$1 FOR NO KEY UPDATE', [purchase.app_user_id]);
        if (!user) return await finish('review', 'unknown_user');
        // Inactive products still fulfill purchases already paid for.
        const { rows: [product] } = await c.query('SELECT * FROM iap_products WHERE product_id=$1', [purchase.product_id]);
        if (!product) return await finish('review', 'unknown_product');
        const price = purchase.raw_event?.price;
        const result = await c.query(`INSERT INTO iap_purchases(user_id,product_id,app_id,environment,store,store_transaction_id,
          granted_gems,granted_card_fragments,price_usd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [user.user_id,product.product_id,...args,product.grant_gems,product.grant_card_fragments,
            typeof price === 'number' && Number.isFinite(price) && price >= 0 && price < 100000000 ? price : null]);
        p = result.rows[0];
      }
      if (p.product_id !== e.product_id) return await finish('review', 'transaction_product_mismatch');
      if (!p.user_id) {
        await c.query("UPDATE iap_events SET app_user_id=NULL,raw_event=jsonb_build_object('redacted',true) WHERE event_id=$1", [eventId]);
        return await finish('review', 'deleted_account');
      }
      const { rows: [user] } = await c.query('SELECT * FROM users WHERE user_id=$1 FOR NO KEY UPDATE', [p.user_id]);
      if (!user) return await finish('review', 'deleted_account');
      // Ordering uses provider timestamps, never delivery order. Cancellation wins ties conservatively.
      const { rows: [refund] } = await c.query(`SELECT * FROM iap_events WHERE app_id=$1 AND environment=$2 AND store=$3 AND transaction_id=$4
        AND product_id=$5 AND type IN ('CANCELLATION','REFUND_REVERSED') AND event_timestamp_ms > 0
        ORDER BY event_timestamp_ms DESC, (type='CANCELLATION') DESC LIMIT 1`, [...args,p.product_id]);
      const refunded = refund?.type === REFUND;
      let gems = 0, fragments = 0, kind = '';
      if (refunded && p.status !== 'refunded') {
        if (p.credited) {
          gems = -Math.min(user.gems, p.granted_gems);
          fragments = -Math.min(user.card_fragments, p.granted_card_fragments);
          const spent = -gems < p.granted_gems || -fragments < p.granted_card_fragments;
          if (spent) {
            await c.query(`UPDATE users SET iap_refund_strikes=iap_refund_strikes+1,
              iap_blocked_at=COALESCE(iap_blocked_at,now()),
              iap_auto_banned_at=CASE WHEN iap_refund_strikes >= 1 AND banned_at IS NULL THEN now() ELSE iap_auto_banned_at END,
              banned_at=CASE WHEN iap_refund_strikes >= 1 THEN COALESCE(banned_at,now()) ELSE banned_at END,
              banned_reason=CASE WHEN iap_refund_strikes >= 1 AND banned_at IS NULL THEN 'IAP_REFUND_ABUSE' ELSE banned_reason END
              WHERE user_id=$1`, [p.user_id]);
          }
          await c.query('UPDATE iap_purchases SET deducted_gems=$2,deducted_fragments=$3,refund_strike=$4 WHERE id=$1', [p.id,-gems,-fragments,spent]);
          kind = 'refund';
        }
        await c.query("UPDATE iap_purchases SET status='refunded',refunded_at=now() WHERE id=$1", [p.id]);
      } else if (!refunded && p.status === 'refunded' && p.credited) {
        // Restore only what was actually deducted, and undo only this purchase's strike.
        gems = p.deducted_gems; fragments = p.deducted_fragments; kind = 'refund_reversed';
        if (p.refund_strike) {
          await c.query(`UPDATE users SET iap_refund_strikes=GREATEST(iap_refund_strikes-1,0),
            iap_blocked_at=CASE WHEN iap_refund_strikes <= 1 THEN NULL ELSE iap_blocked_at END,
            banned_at=CASE WHEN iap_refund_strikes <= 2 AND banned_at=iap_auto_banned_at AND banned_reason='IAP_REFUND_ABUSE' THEN NULL ELSE banned_at END,
            banned_reason=CASE WHEN iap_refund_strikes <= 2 AND banned_at=iap_auto_banned_at AND banned_reason='IAP_REFUND_ABUSE' THEN NULL ELSE banned_reason END,
            iap_auto_banned_at=CASE WHEN iap_refund_strikes <= 2 THEN NULL ELSE iap_auto_banned_at END WHERE user_id=$1`, [p.user_id]);
        }
        await c.query("UPDATE iap_purchases SET status='granted',refunded_at=NULL,deducted_gems=0,deducted_fragments=0,refund_strike=false WHERE id=$1", [p.id]);
      } else if (!refunded && !p.credited) {
        if (user.banned_at) {
          await c.query("UPDATE iap_purchases SET status='pending_banned_review' WHERE id=$1", [p.id]);
          return await finish('review', 'banned_account');
        }
        gems = p.granted_gems; fragments = p.granted_card_fragments; kind = 'grant';
        await c.query("UPDATE iap_purchases SET status='granted',credited=true,refunded_at=NULL WHERE id=$1", [p.id]);
      }
      if (kind) {
        await c.query('UPDATE users SET gems=gems+$2,card_fragments=card_fragments+$3 WHERE user_id=$1', [p.user_id,gems,fragments]);
        await c.query('INSERT INTO iap_movements(purchase_id,event_id,kind,gems,card_fragments) VALUES($1,$2,$3,$4,$5)', [p.id,eventId,kind,gems,fragments]);
        changedUser = p.user_id;
      }
      if (refund) await c.query('UPDATE iap_purchases SET last_refund_ms=$2,last_refund_type=$3 WHERE id=$1', [p.id,refund.event_timestamp_ms,refund.type]);
      // Previously out-of-order events are now accounted for by the projection.
      await c.query(`UPDATE iap_events SET state='processed',issue=NULL,processed_at=now()
        WHERE app_id=$1 AND environment=$2 AND store=$3 AND transaction_id=$4 AND product_id=$5
        AND issue IN ('awaiting_purchase','banned_account','unknown_user','unknown_product')`, [...args,p.product_id]);
      return await finish('processed');
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      c.release();
      if (changedUser) await cacheInvalidation.invalidateUserProfile(changedUser).catch(() => undefined);
    }
  },
};

let retryTimer: NodeJS.Timeout | undefined;
let retryRunning = false;
export function startIapRetries() {
  if (retryTimer || !iapConfig().enabled) return;
  retryTimer = setInterval(async () => {
    if (retryRunning) return;
    retryRunning = true;
    try {
      const { rows } = await db.query(`SELECT event_id FROM iap_events WHERE
        (state='received' OR state='review' AND issue IN ('unknown_user','unknown_product','awaiting_purchase'))
        AND received_at > now() - interval '7 days' ORDER BY processed_at NULLS FIRST,received_at LIMIT 50`);
      for (const e of rows) {
        try { await IapService.process(e.event_id); }
        catch { console.error('IAP retry failed', {eventId:e.event_id}); }
      }
    } catch { console.error('IAP retry queue unavailable'); }
    finally { retryRunning=false; }
  }, 60000);
  retryTimer.unref();
}
export function stopIapRetries() { if (retryTimer) clearInterval(retryTimer); retryTimer=undefined; }
