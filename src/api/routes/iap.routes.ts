import { Router, Request, Response, NextFunction } from 'express';
import db from '../../config/db.config';
import { authenticateJWT } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/adminAuth.middleware';
import { moderateRateLimit } from '../middlewares/rateLimit.middleware';
import { revenuecatWebhook } from '../controllers/iap.controller';
import { IapService } from '../../services/iap.service';
import { IapModel } from '../../models/iap.model';
import { isUuid } from '../../types/iap.types';
import { cacheInvalidation } from '../../services/cache.invalidation.service';
const router = Router();
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req,res).catch(next); };
router.post('/webhook/revenuecat', revenuecatWebhook);
router.use(authenticateJWT, moderateRateLimit);
router.get('/catalog', wrap(async (req,res) => res.json(await IapService.catalog(req.user!.user_id))));
router.get('/purchases/status', wrap(async (req,res) => {
  const id = req.query.transaction_id, store = req.query.store;
  if (typeof id !== 'string' || !id || id.length > 512 || !['APP_STORE','PLAY_STORE'].includes(String(store))) return res.sendStatus(400);
  res.json(await IapModel.status(req.user!.user_id,id,String(store)));
}));
router.get('/purchases', wrap(async (req,res) => {
  res.json((await db.query(`SELECT id,product_id,status,store,store_transaction_id,granted_gems,granted_card_fragments,created_at
    FROM iap_purchases WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user!.user_id])).rows);
}));
router.use('/admin', requireAdmin);
router.get('/admin/products', wrap(async (_req,res) => res.json(await IapModel.products())));
router.patch('/admin/products/:id', wrap(async (req,res) => {
  // Currency grants are immutable after product creation: new amounts require a new SKU.
  const { active, display_name, description, badge, sort_order } = req.body;
  if (typeof active !== 'boolean' || typeof display_name !== 'string' || !display_name.trim() || display_name.length > 150
    || !(description === null || typeof description === 'string' && description.length <= 1000)
    || !(badge === null || typeof badge === 'string' && badge.length <= 60) || !Number.isSafeInteger(sort_order) || Math.abs(sort_order) > 100000) return res.sendStatus(400);
  const c = await db.getClient();
  try {
    await c.query('BEGIN');
    const result = await c.query('UPDATE iap_products SET active=$2,display_name=$3,description=$4,badge=$5,sort_order=$6 WHERE product_id=$1 RETURNING *', [req.params.id,active,display_name,description,badge,sort_order]);
    if (!result.rowCount) { await c.query('ROLLBACK'); return res.sendStatus(404); }
    await c.query('INSERT INTO iap_admin_audit(actor_id,action,target,detail) VALUES($1,$2,$3,$4)', [req.user!.user_id,'update_product',req.params.id,JSON.stringify(result.rows[0])]);
    await c.query('COMMIT'); res.json(result.rows[0]);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}));
router.get('/admin/review', wrap(async (_req,res) => {
  const events = (await db.query(`SELECT event_id,type,app_user_id,product_id,transaction_id,issue,received_at FROM iap_events
    WHERE state IN ('received','review') ORDER BY received_at LIMIT 200`)).rows;
  const purchases = (await db.query("SELECT * FROM iap_purchases WHERE status='pending_banned_review' ORDER BY created_at LIMIT 200")).rows;
  res.json({ events, purchases });
}));
router.get('/admin/users/:id/purchases', wrap(async (req,res) => {
  if (!isUuid(req.params.id)) return res.sendStatus(400);
  const purchases = (await db.query('SELECT * FROM iap_purchases WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200', [req.params.id])).rows;
  const { rows: [enforcement] } = await db.query('SELECT iap_refund_strikes,iap_blocked_at,banned_at,banned_reason FROM users WHERE user_id=$1', [req.params.id]);
  res.json({ purchases, enforcement });
}));
router.post('/admin/events/:id/replay', wrap(async (req,res) => {
  const { rows: [event] } = await db.query('SELECT event_id FROM iap_events WHERE event_id=$1', [req.params.id]);
  if (!event) return res.sendStatus(404);
  await db.query('INSERT INTO iap_admin_audit(actor_id,action,target,detail) VALUES($1,$2,$3,$4)', [req.user!.user_id,'replay_event',req.params.id,JSON.stringify({})]);
  res.json({ state: await IapService.process(req.params.id) });
}));
router.post('/admin/users/:id/appeal', wrap(async (req,res) => {
  if (!isUuid(req.params.id) || typeof req.body.reason !== 'string' || req.body.reason.trim().length < 10 || req.body.reason.length > 2000) return res.sendStatus(400);
  const c = await db.getClient();
  try {
    await c.query('BEGIN');
    const { rows: [user] } = await c.query('SELECT * FROM users WHERE user_id=$1 FOR NO KEY UPDATE', [req.params.id]);
    if (!user) { await c.query('ROLLBACK'); return res.sendStatus(404); }
    await c.query(`UPDATE users SET iap_refund_strikes=0,iap_blocked_at=NULL,
      banned_at=CASE WHEN banned_at=iap_auto_banned_at AND banned_reason='IAP_REFUND_ABUSE' THEN NULL ELSE banned_at END,
      banned_reason=CASE WHEN banned_at=iap_auto_banned_at AND banned_reason='IAP_REFUND_ABUSE' THEN NULL ELSE banned_reason END,
      iap_auto_banned_at=NULL WHERE user_id=$1`, [req.params.id]);
    await c.query('UPDATE iap_purchases SET refund_strike=false WHERE user_id=$1', [req.params.id]);
    await c.query('INSERT INTO iap_admin_audit(actor_id,action,target,detail) VALUES($1,$2,$3,$4)',
      [req.user!.user_id,'approve_appeal',req.params.id,JSON.stringify({reason:req.body.reason,previousStrikes:user.iap_refund_strikes})]);
    await c.query('COMMIT');
    await cacheInvalidation.invalidateUserProfile(req.params.id);
    res.json({ ok:true });
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}));
export default router;
