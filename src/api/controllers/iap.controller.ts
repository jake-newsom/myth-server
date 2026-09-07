import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { iapConfig } from '../../config/iap.config';
import { parseRcEvent } from '../../types/iap.types';
import { IapModel } from '../../models/iap.model';
import { IapService } from '../../services/iap.service';

export function authorizedIapHeader(header: string | undefined, expected: string): boolean {
  if (!header || !expected) return false;
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a,b);
}
export async function revenuecatWebhook(req: Request, res: Response, next: NextFunction) {
  const cfg = iapConfig();
  if (!cfg.enabled) return res.sendStatus(503);
  if (!authorizedIapHeader(req.get('authorization'),cfg.webhookAuth)) {
    console.warn('Rejected RevenueCat webhook authorization');
    return res.status(401).end();
  }
  const event = parseRcEvent(req.body);
  if (!event) return res.status(400).end();
  try {
    await IapModel.receive(event);
    const state = await IapService.process(event.id);
    if (state === 'review') console.warn('IAP event requires review', { eventId: event.id });
    return res.json({ received: true });
  } catch (err) { next(err); }
}
