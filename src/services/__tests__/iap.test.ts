import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const source = process.env.IAP_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!source) throw new Error('Set IAP_TEST_DATABASE_URL to a local Postgres database');
const url = new URL(source);
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('IAP tests only run against localhost');
const schema = `iap_test_${randomUUID().replace(/-/g,'')}`;
const admin = new Pool({ connectionString:source });
let db: any, service: any, model: any, cache: any;
const userId=randomUUID();
let time=100000;
function event(type='NON_RENEWING_PURCHASE', overrides: any={}) {
  return { id:randomUUID(), type, app_id:'app_test', environment:'SANDBOX',store:'APP_STORE',
    app_user_id:userId, product_id:'com.myth.gems.small', transaction_id:randomUUID(),event_timestamp_ms:++time, ...overrides };
}
async function send(e:any) { await model.receive(e); return service.process(e.id); }
async function user(id=userId) { return (await db.query('SELECT * FROM users WHERE user_id=$1',[id])).rows[0]; }
async function reset() {
  await db.query('TRUNCATE iap_movements,iap_purchases,iap_events,iap_admin_audit,users CASCADE');
  await db.query('INSERT INTO users(user_id) VALUES($1)',[userId]);
}
before(async()=>{
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options',`-c search_path=${schema},public`);
  process.env.DATABASE_URL=url.toString();
  process.env.IAP_ENABLED='true'; process.env.IAP_ENVIRONMENT='SANDBOX'; process.env.REVENUECAT_APP_IDS='app_test';
  db=require('../../config/db.config').default;
  await db.query(`CREATE TABLE users(user_id uuid PRIMARY KEY,gems integer NOT NULL DEFAULT 0 CHECK(gems>=0),
    card_fragments integer NOT NULL DEFAULT 0,banned_at timestamptz,banned_reason text)`);
  const sql:string[]=[];
  require('../../../migrations/1799000000014_iap-ledger').up({sql:(s:string)=>sql.push(s)});
  for(const s of sql) await db.query(s);
  service=require('../iap.service').IapService; model=require('../../models/iap.model').IapModel;
  cache=require('../cache.invalidation.service').cacheInvalidation;
  cache.invalidateUserProfile=async()=>{};
});
after(async()=>{
  if(db) await db.pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});
test('duplicate and concurrent delivery grants exactly once',async()=>{
  await reset();const e=event();await model.receive(e);
  await Promise.all([service.process(e.id),service.process(e.id),send({...e,id:randomUUID()})]);
  assert.equal((await user()).gems,100);
  assert.equal((await db.query('SELECT * FROM iap_movements')).rowCount,1);
});
test('two concurrent purchases add both grants',async()=>{
  await reset();await Promise.all([send(event()),send(event())]);assert.equal((await user()).gems,200);
});
test('all six catalogue bundles grant the configured amounts',async()=>{
  await reset();for(const p of await model.products()) await send(event('NON_RENEWING_PURCHASE',{product_id:p.product_id}));
  assert.equal((await user()).gems,1850);assert.equal((await user()).card_fragments,4400);
});
test('clean refund, duplicate refund, reversal and stale refund',async()=>{
  await reset();const e=event();await send(e);const refund=event('CANCELLATION',{transaction_id:e.transaction_id});
  await send(refund);await send({...refund,id:randomUUID()});assert.equal((await user()).gems,0);assert.equal((await user()).iap_refund_strikes,0);
  await send(event('REFUND_REVERSED',{transaction_id:e.transaction_id}));assert.equal((await user()).gems,100);
  await send({...refund,id:randomUUID()});assert.equal((await user()).gems,100);
});
test('spent refunds block then ban; reversal restores only deducted currency and own strike',async()=>{
  await reset();const a=event(),b=event();await send(a);await send(b);
  await db.query('UPDATE users SET gems=30');
  await send(event('CANCELLATION',{transaction_id:a.transaction_id}));
  assert.equal((await user()).gems,0);assert.ok((await user()).iap_blocked_at);assert.equal((await user()).banned_at,null);
  await send(event('CANCELLATION',{transaction_id:b.transaction_id}));assert.ok((await user()).banned_at);
  await send(event('REFUND_REVERSED',{transaction_id:a.transaction_id}));
  assert.equal((await user()).gems,30);assert.equal((await user()).iap_refund_strikes,1);assert.equal((await user()).banned_at,null);
});
test('refund before purchase creates no credit or strike; reversal then credits',async()=>{
  await reset();const e=event();const r=event('CANCELLATION',{transaction_id:e.transaction_id});
  assert.equal(await send(r),'review');await send(e);assert.equal((await user()).gems,0);assert.equal((await user()).iap_refund_strikes,0);
  assert.equal((await db.query('SELECT status FROM iap_purchases')).rows[0].status,'refunded');
  await send(event('REFUND_REVERSED',{transaction_id:e.transaction_id}));assert.equal((await user()).gems,100);
});
test('blocked users receive paid grants; banned users enter review and refund without a strike',async()=>{
  await reset();await db.query('UPDATE users SET iap_blocked_at=now()');await send(event());assert.equal((await user()).gems,100);
  await db.query("UPDATE users SET banned_at=now(),banned_reason='other'");const e=event();assert.equal(await send(e),'review');
  await send(event('CANCELLATION',{transaction_id:e.transaction_id}));assert.equal((await user()).gems,100);assert.equal((await user()).iap_refund_strikes,0);
});
test('banned purchase can be replayed after account review without double credit',async()=>{
  await reset();await db.query('UPDATE users SET banned_at=now()');const e=event();await send(e);
  await db.query('UPDATE users SET banned_at=NULL');await service.process(e.id);await service.process(e.id);assert.equal((await user()).gems,100);
});
test('environment, app, unknown SKU, missing transaction and user failures are durable',async()=>{
  await reset();for(const overrides of [{environment:'PRODUCTION'},{app_id:'other'},{product_id:'unknown'},{transaction_id:null},{app_user_id:randomUUID()}]) {
    assert.equal(await send(event('NON_RENEWING_PURCHASE',overrides)),'review');
  }
  assert.equal((await user()).gems,0);assert.equal((await db.query("SELECT * FROM iap_events WHERE state='review'")).rowCount,5);
});
test('deactivated products honor paid purchases',async()=>{
  await reset();await db.query("UPDATE iap_products SET active=false WHERE product_id='com.myth.gems.small'");
  await send(event());assert.equal((await user()).gems,100);
  await db.query('UPDATE iap_products SET active=true');
});
test('transfers do not change refund recipient; deletion preserves transaction tombstones',async()=>{
  await reset();const other=randomUUID();await db.query('INSERT INTO users(user_id) VALUES($1)',[other]);const e=event();await send(e);
  await send(event('TRANSFER',{transferred_from:[userId],transferred_to:[other]}));
  await send(event('CANCELLATION',{transaction_id:e.transaction_id,app_user_id:other}));assert.equal((await user()).gems,0);assert.equal((await user(other)).gems,0);
  await model.scrubUser(db,userId);await db.query('DELETE FROM users WHERE user_id=$1',[userId]);
  await send({...e,id:randomUUID()});assert.equal((await db.query('SELECT * FROM iap_purchases')).rowCount,1);
});
test('integer overflow rolls back ledger and remains retryable',async()=>{
  await reset();await db.query('UPDATE users SET gems=2147483640');const e=event();await assert.rejects(send(e));
  assert.equal((await db.query('SELECT * FROM iap_purchases')).rowCount,0);
  await db.query('UPDATE users SET gems=0');await service.process(e.id);assert.equal((await user()).gems,100);
});
test('webhook auth fails closed and accepts only an exact header',()=>{
  const {authorizedIapHeader}=require('../../api/controllers/iap.controller');
  assert.equal(authorizedIapHeader(undefined,''),false);assert.equal(authorizedIapHeader('wrong','secret'),false);
  assert.equal(authorizedIapHeader('secret','secret'),true);
});
test('flag-off hides catalog but does not discard paid transactions',async()=>{
  await reset();const flags=require('../featureFlag.service').default;const original=flags.isEnabled;
  flags.isEnabled=async()=>false;
  try {assert.deepEqual(await service.catalog(userId),[]);await send(event());assert.equal((await user()).gems,100);}
  finally {flags.isEnabled=original;}
});
test('catalog and status enforce account eligibility and purchase ownership',async()=>{
  await reset();const e=event();await send(e);
  assert.equal((await model.catalog(userId)).length,6);
  await db.query('UPDATE users SET iap_blocked_at=now()');assert.deepEqual(await model.catalog(userId),[]);
  assert.equal((await model.status(randomUUID(),e.transaction_id,'APP_STORE')).status,'pending');
  assert.equal((await model.status(userId,e.transaction_id,'APP_STORE')).status,'granted');
});
test('refund uses recorded grant; reversing it preserves an unrelated ban',async()=>{
  await reset();const e=event();await send(e);
  await db.query("UPDATE iap_products SET grant_gems=500 WHERE product_id='com.myth.gems.small'");
  await db.query("UPDATE users SET gems=10,banned_at=now(),banned_reason='manual moderation'");
  await send(event('CANCELLATION',{transaction_id:e.transaction_id}));
  await send(event('REFUND_REVERSED',{transaction_id:e.transaction_id}));
  assert.equal((await user()).gems,10);assert.equal((await user()).banned_reason,'manual moderation');assert.ok((await user()).banned_at);
  await db.query("UPDATE iap_products SET grant_gems=100 WHERE product_id='com.myth.gems.small'");
});
test('HTTP webhook rejects unauthorized payloads before persistence and returns 500 on DB failure',async()=>{
  await reset();const express=require('express');const app=express();app.use(express.json());
  const {revenuecatWebhook}=require('../../api/controllers/iap.controller');app.post('/webhook',revenuecatWebhook);
  app.use((_e:any,_req:any,res:any,_next:any)=>res.sendStatus(500));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const address=server.address();const target=`http://127.0.0.1:${address.port}/webhook`;
  process.env.REVENUECAT_WEBHOOK_AUTH='test-auth-value';
  try {
    const body=JSON.stringify({event:event()});
    const denied=await fetch(target,{method:'POST',headers:{'content-type':'application/json',authorization:'wrong'},body});assert.equal(denied.status,401);
    assert.equal((await db.query('SELECT * FROM iap_events')).rowCount,0);
    const good=await fetch(target,{method:'POST',headers:{'content-type':'application/json',authorization:'test-auth-value'},body});assert.equal(good.status,200);
    await db.query('UPDATE users SET gems=2147483640');
    const failed=await fetch(target,{method:'POST',headers:{'content-type':'application/json',authorization:'test-auth-value'},body:JSON.stringify({event:event()})});assert.equal(failed.status,500);
    assert.equal((await db.query("SELECT * FROM iap_events WHERE state='received'")).rowCount,1);
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});
