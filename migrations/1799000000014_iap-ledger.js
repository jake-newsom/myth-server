const products = require('../config/iap-products.json');
exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE iap_products (
      product_id text PRIMARY KEY, internal_id text NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT true,
      grant_gems integer NOT NULL CHECK (grant_gems >= 0),
      grant_card_fragments integer NOT NULL CHECK (grant_card_fragments >= 0),
      display_name text NOT NULL, description text, badge text, sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (grant_gems > 0 OR grant_card_fragments > 0)
    );
    ALTER TABLE users ADD COLUMN iap_blocked_at timestamptz,
      ADD COLUMN iap_refund_strikes integer NOT NULL DEFAULT 0 CHECK (iap_refund_strikes >= 0),
      ADD COLUMN iap_auto_banned_at timestamptz;
    CREATE TABLE iap_events (
      event_id text PRIMARY KEY, type text NOT NULL, app_id text,
      environment text, store text, transaction_id text,
      app_user_id text, product_id text, event_timestamp_ms bigint,
      raw_event jsonb NOT NULL, state text NOT NULL DEFAULT 'received', issue text,
      received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
    );
    CREATE INDEX iap_events_transaction ON iap_events (app_id, environment, store, transaction_id);
    CREATE INDEX iap_events_pending ON iap_events (received_at) WHERE state IN ('received','review');
    CREATE TABLE iap_purchases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      product_id text NOT NULL REFERENCES iap_products(product_id),
      app_id text NOT NULL, environment text NOT NULL, store text NOT NULL,
      store_transaction_id text NOT NULL,
      granted_gems integer NOT NULL CHECK (granted_gems >= 0),
      granted_card_fragments integer NOT NULL CHECK (granted_card_fragments >= 0),
      price_usd numeric(12,4),
      status text NOT NULL DEFAULT 'pending',
      credited boolean NOT NULL DEFAULT false,
      deducted_gems integer NOT NULL DEFAULT 0, deducted_fragments integer NOT NULL DEFAULT 0,
      refund_strike boolean NOT NULL DEFAULT false,
      last_refund_ms bigint NOT NULL DEFAULT 0,
      last_refund_type text,
      created_at timestamptz NOT NULL DEFAULT now(), refunded_at timestamptz,
      UNIQUE (app_id, environment, store, store_transaction_id)
    );
    CREATE INDEX iap_purchases_user ON iap_purchases(user_id, created_at);
    CREATE TABLE iap_movements (
      id bigserial PRIMARY KEY, purchase_id uuid NOT NULL REFERENCES iap_purchases(id),
      event_id text NOT NULL REFERENCES iap_events(event_id),
      kind text NOT NULL, gems integer NOT NULL, card_fragments integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(purchase_id, event_id, kind)
    );
    CREATE TABLE iap_admin_audit (
      id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
      action text NOT NULL, target text NOT NULL, detail jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  for (const p of products) {
    const quote = value => value === null ? 'NULL' : "'" + String(value).replace(/'/g, "''") + "'";
    pgm.sql(`INSERT INTO iap_products (${Object.keys(p).join(',')}) VALUES (${Object.values(p).map(quote).join(',')})`);
  }
};
exports.down = pgm => {
  pgm.sql(`DROP TABLE iap_admin_audit, iap_movements, iap_purchases, iap_events, iap_products;
    ALTER TABLE users DROP COLUMN iap_blocked_at, DROP COLUMN iap_refund_strikes, DROP COLUMN iap_auto_banned_at;`);
};
