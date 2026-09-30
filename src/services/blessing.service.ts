import db from '../config/db.config';
import MailModel from '../models/mail.model';

/** Sends one UTC-day reward mail for every active blessing. The unique day key
 * makes retries safe if the cron process restarts or overlaps. */
export async function sendBlessingDailyMail(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const { rows } = await db.query(`SELECT b.*, u.username
    FROM iap_blessings b JOIN users u ON u.user_id=b.user_id
    WHERE b.status='active' AND b.starts_at < $1::date + interval '1 day'
      AND b.expires_at > $1::date`, [day]);
  let sent = 0;
  for (const blessing of rows) {
    const c = await db.getClient();
    try {
      await c.query('BEGIN');
      const inserted = await c.query(`INSERT INTO iap_blessing_mail_days(blessing_id,reward_date)
        VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING blessing_id`, [blessing.id, day]);
      if (inserted.rowCount) {
        const mail = await MailModel.create({ user_id: blessing.user_id, mail_type: 'reward', subject: 'Your daily blessing',
          content: 'Your 30-Day Blessing rewards are ready to claim.', has_rewards: true,
          reward_gems: blessing.daily_gems, reward_embers: blessing.daily_embers }, c);
        await c.query('UPDATE iap_blessing_mail_days SET mail_id=$3 WHERE blessing_id=$1 AND reward_date=$2', [blessing.id, day, mail.id]);
        sent++;
      }
      await c.query('UPDATE iap_blessings SET status=\'expired\' WHERE id=$1 AND expires_at <= now()', [blessing.id]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  return sent;
}
