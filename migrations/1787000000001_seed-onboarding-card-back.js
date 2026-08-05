/* eslint-disable camelcase */

/**
 * Seeds the card back awarded at onboarding milestone day 30.
 *
 * Referenced by code_key (not back_id) from src/config/onboarding.config.ts so
 * the reference is stable across environments. image_url is NOT NULL, so the
 * final intended asset path ships here even if the art is not yet in place --
 * a 404 placeholder is recoverable, a missing row is not.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO card_backs (code_key, name, description, image_url, is_active)
    VALUES (
      'onboarding-day-30',
      'Founder''s Seal',
      'Awarded to founding players who returned for 30 days.',
      '/assets/card-backs/onboarding-day-30.png',
      true
    )
    ON CONFLICT (code_key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM card_backs WHERE code_key = 'onboarding-day-30';`);
};
