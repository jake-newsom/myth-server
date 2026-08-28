/* eslint-disable camelcase */

/**
 * Adds the `shop_item_type` values the shop overhaul introduces:
 *
 *   - `fragment_bundle`   150 card fragments, bought with gems
 *   - `fate_coin_bundle`  5 fate coins, bought with gems
 *   - `soul_card`         a single card priced in card fragments (Soul Shop)
 *
 * Ships ALONE, for the same reason as 1798000000001_add-ember-enum-values:
 * Postgres refuses to let a statement use an enum value whose adding
 * transaction has not committed. The config rows that reference these labels
 * therefore live in a later migration file, not here.
 *
 * ## `disableTransaction` here is NOT sufficient on its own
 *
 * node-pg-migrate's `singleTransaction` option defaults to ON, wrapping the
 * ENTIRE run in one transaction. A `disableTransaction` file only gets a
 * `COMMIT;` prepended and a fresh `BEGIN;` appended — so these ALTER TYPEs land
 * in a new, still-uncommitted transaction, and the next file's INSERT fails with
 * "unsafe use of new value ... New enum values must be committed before they can
 * be used". Worse, the failure rolls the labels back too, so the run is
 * all-or-nothing and no amount of retrying helps.
 *
 * The run must therefore use `--no-single-transaction`, which commits each
 * migration independently. That is why `render:start` calls `migrate:deploy`
 * (which passes that flag) rather than a bare `migrate:up`, and why the local
 * equivalent is `npm run migrate:up:enum`. A plain `npm run migrate:up` WILL
 * fail on a database that has not yet run this pair.
 *
 * Release-safety: adding enum labels is additive. Nothing existing changes, and
 * no client can be handed one of these strings until a config row and an
 * offering exist. Old clients that do see one simply skip an offering shape
 * they do not recognise.
 *
 * No `down`: Postgres has no ALTER TYPE ... DROP VALUE. Unused labels are inert.
 */

exports.shorthands = undefined;

// Required: see the note above about enum values and transactions.
exports.disableTransaction = true;

exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE shop_item_type ADD VALUE IF NOT EXISTS 'fragment_bundle';`);
  pgm.sql(`ALTER TYPE shop_item_type ADD VALUE IF NOT EXISTS 'fate_coin_bundle';`);
  pgm.sql(`ALTER TYPE shop_item_type ADD VALUE IF NOT EXISTS 'soul_card';`);
};

exports.down = () => {
  // Intentionally a no-op: Postgres cannot drop an enum value.
};
