/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE iap_products
      ADD COLUMN product_kind text NOT NULL DEFAULT 'currency',
      ADD COLUMN grant_packs integer NOT NULL DEFAULT 0,
      ADD COLUMN grant_embers integer NOT NULL DEFAULT 0,
      ADD COLUMN grant_card_back_code text,
      ADD COLUMN price_usd numeric(10,2),
      ADD COLUMN blessing_duration_days integer,
      ADD COLUMN blessing_daily_gems integer NOT NULL DEFAULT 0,
      ADD COLUMN blessing_daily_embers integer NOT NULL DEFAULT 0,
      ADD COLUMN blessing_gameplay_xp_multiplier numeric(5,4),
      ADD COLUMN max_per_account integer;
    ALTER TABLE iap_purchases
      ADD COLUMN granted_packs integer NOT NULL DEFAULT 0,
      ADD COLUMN granted_embers integer NOT NULL DEFAULT 0,
      ADD COLUMN product_kind text NOT NULL DEFAULT 'currency';
    ALTER TABLE iap_movements
      ADD COLUMN packs integer NOT NULL DEFAULT 0,
      ADD COLUMN embers integer NOT NULL DEFAULT 0;
    ALTER TABLE iap_products DROP CONSTRAINT IF EXISTS iap_products_check;
    ALTER TABLE iap_products ADD CONSTRAINT iap_products_kind_check
      CHECK (product_kind IN ('currency','starter_pack','blessing_30_day'));
    ALTER TABLE iap_products ADD CONSTRAINT iap_products_grants_check
      CHECK (grant_gems >= 0 AND grant_card_fragments >= 0 AND grant_packs >= 0 AND grant_embers >= 0);
    ALTER TABLE mail ADD COLUMN reward_embers integer NOT NULL DEFAULT 0;
    ALTER TABLE mail ADD CONSTRAINT mail_reward_embers_check CHECK (reward_embers >= 0);
    ALTER TABLE mail DROP CONSTRAINT IF EXISTS has_rewards_consistency_check;
    ALTER TABLE mail ADD CONSTRAINT has_rewards_consistency_check CHECK (
      (has_rewards = false AND reward_gold = 0 AND reward_gems = 0 AND reward_packs = 0 AND reward_embers = 0 AND reward_fate_coins = 0 AND array_length(reward_card_ids, 1) IS NULL) OR
      (has_rewards = true AND (reward_gold > 0 OR reward_gems > 0 OR reward_packs > 0 OR reward_embers > 0 OR reward_fate_coins > 0 OR array_length(reward_card_ids, 1) > 0 OR reward_card_back_id IS NOT NULL))
    );
    INSERT INTO card_backs (code_key, name, description, image_url, is_active)
      VALUES ('starter_exclusive_card_back', 'Starter Card Back', 'Placeholder artwork for the starter pack exclusive card back.', '/assets/card-backs/starter-placeholder.png', true)
      ON CONFLICT (code_key) DO NOTHING;
    UPDATE iap_products SET active = false WHERE internal_id IN ('gems_small','gems_medium','gems_large');
    INSERT INTO iap_products (product_id, internal_id, product_kind, active, grant_gems, grant_card_fragments, grant_packs, grant_embers, grant_card_back_code, price_usd, display_name, description, badge, sort_order, max_per_account)
      VALUES
      ('com.myth.gems.100','gems_100','currency',true,100,0,0,0,NULL,0.99,'100 Gems','100 gems',NULL,10,NULL),
      ('com.myth.gems.750','gems_750','currency',true,750,0,0,0,NULL,5.99,'750 Gems','750 gems','Popular',20,NULL),
      ('com.myth.gems.1500','gems_1500','currency',true,1500,0,0,0,NULL,9.99,'1,500 Gems','1,500 gems','Best value',30,NULL),
      ('com.myth.gems.3000','gems_3000','currency',true,3000,0,0,0,NULL,19.99,'3,000 Gems','3,000 gems',NULL,40,NULL),
      ('com.myth.starter.pack','starter_pack','starter_pack',true,1000,0,20,50,'starter_exclusive_card_back',4.99,'Starter Pack','1,000 gems, 20 packs, 50 embers, and an exclusive card back','Once per account',80,1),
      ('com.myth.blessing.30day','blessing_30_day','blessing_30_day',true,0,0,0,0,NULL,4.99,'30-Day Blessing','50 gems and 10 embers each day for 30 days, plus 20% gameplay card XP',NULL,90,NULL)
      ON CONFLICT (product_id) DO UPDATE SET active=EXCLUDED.active, internal_id=EXCLUDED.internal_id, product_kind=EXCLUDED.product_kind,
        grant_gems=EXCLUDED.grant_gems, grant_packs=EXCLUDED.grant_packs, grant_embers=EXCLUDED.grant_embers,
        grant_card_back_code=EXCLUDED.grant_card_back_code, price_usd=EXCLUDED.price_usd, display_name=EXCLUDED.display_name,
        description=EXCLUDED.description, badge=EXCLUDED.badge, sort_order=EXCLUDED.sort_order, max_per_account=EXCLUDED.max_per_account;
    UPDATE iap_products SET price_usd=1.99 WHERE internal_id='fragments_small';
    UPDATE iap_products SET price_usd=9.99 WHERE internal_id='fragments_medium';
    UPDATE iap_products SET price_usd=19.99 WHERE internal_id='fragments_large';
    UPDATE iap_products SET blessing_duration_days=30, blessing_daily_gems=50,
      blessing_daily_embers=10, blessing_gameplay_xp_multiplier=1.2
      WHERE internal_id='blessing_30_day';
    CREATE TABLE iap_product_ownership (
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      product_id text NOT NULL REFERENCES iap_products(product_id),
      purchase_id uuid NOT NULL REFERENCES iap_purchases(id),
      granted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, product_id), UNIQUE (purchase_id)
    );
    CREATE TABLE iap_blessings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      purchase_id uuid NOT NULL UNIQUE REFERENCES iap_purchases(id),
      starts_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      daily_gems integer NOT NULL CHECK (daily_gems >= 0),
      daily_embers integer NOT NULL CHECK (daily_embers >= 0),
      gameplay_xp_multiplier numeric(5,4) NOT NULL DEFAULT 1.2,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','refunded')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX iap_blessings_one_active ON iap_blessings(user_id) WHERE status='active';
    CREATE TABLE iap_blessing_mail_days (
      blessing_id uuid NOT NULL REFERENCES iap_blessings(id) ON DELETE CASCADE,
      reward_date date NOT NULL,
      mail_id uuid REFERENCES mail(id) ON DELETE SET NULL,
      sent_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (blessing_id, reward_date)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS iap_blessing_mail_days, iap_blessings, iap_product_ownership;
    ALTER TABLE mail DROP CONSTRAINT IF EXISTS mail_reward_embers_check, DROP COLUMN IF EXISTS reward_embers;
    ALTER TABLE iap_products DROP CONSTRAINT IF EXISTS iap_products_grants_check, DROP CONSTRAINT IF EXISTS iap_products_kind_check;
    ALTER TABLE iap_products DROP COLUMN IF EXISTS product_kind, DROP COLUMN IF EXISTS grant_packs, DROP COLUMN IF EXISTS grant_embers,
      DROP COLUMN IF EXISTS grant_card_back_code, DROP COLUMN IF EXISTS price_usd, DROP COLUMN IF EXISTS blessing_duration_days,
      DROP COLUMN IF EXISTS blessing_daily_gems, DROP COLUMN IF EXISTS blessing_daily_embers, DROP COLUMN IF EXISTS blessing_gameplay_xp_multiplier,
      DROP COLUMN IF EXISTS max_per_account;`);
};
