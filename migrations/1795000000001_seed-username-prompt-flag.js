/* eslint-disable camelcase */

/**
 * Seeds the first-run username prompt flag, dark.
 *
 * Off => HomePage never shows the modal and the client behaves exactly as it
 * does today. Seeding the row (rather than relying on "unknown key => false")
 * is what allows per-user overrides from the admin console for testing.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (key, description, enabled_globally)
    VALUES (
      'first-run-username-prompt',
      'Prompt social-signup users to choose their own username on first visit to Home.',
      false
    )
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM feature_flags WHERE key = 'first-run-username-prompt';`);
};
