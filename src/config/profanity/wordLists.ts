/**
 * Profanity word lists — data, not logic, so the lists can be tuned without
 * touching the matcher in profanityFilter.service.ts.
 *
 * Kept as a .ts module rather than .json because tsconfig `include` is
 * `src/**\/*` and the build has no asset-copy step: a .json file would resolve
 * in ts-node dev but be missing from `dist/` in production.
 *
 * Both lists are matched on WORD BOUNDARIES ONLY, against a normalized form
 * (lowercased, diacritics stripped, leetspeak folded, repeat-runs collapsed).
 * Substring matching would produce Scunthorpe-class false positives, which in
 * a game chat are worse than a few misses.
 */

/**
 * Tier 1 — hard blocked. Slurs and hate terms.
 *
 * Rejected at send time for EVERYONE regardless of any user's filter toggle:
 * never persisted, never broadcast. The profanity toggle is a display
 * preference and must not be able to opt a user into broadcasting these.
 *
 * Keep curated and small; add terms as moderation reports justify.
 */
export const HARD_BLOCKED_WORDS: readonly string[] = [
  "nigger",
  "nigga",
  "faggot",
  "tranny",
  "kike",
  "spic",
  "chink",
  "gook",
  "wetback",
  "retard",
  "retarded",
  "paki",
  "raghead",
  "towelhead",
  "beaner",
  "shemale",
  "kys",
];

/**
 * Tier 2 — maskable. General profanity.
 *
 * Masked as `f***` for viewers with the filter enabled and shown raw to those
 * without. Deliberately excludes mild words common in normal play talk
 * ("damn", "hell", "crap") — over-masking makes the filter feel broken.
 */
export const MASKABLE_WORDS: readonly string[] = [
  "fuck",
  "fucker",
  "fucking",
  "fucked",
  "motherfucker",
  "shit",
  "shitty",
  "bullshit",
  "bitch",
  "bitches",
  "cunt",
  "asshole",
  "arsehole",
  "dickhead",
  "whore",
  "slut",
  "wanker",
  "bastard",
  "twat",
  "prick",
  "pussy",
  "dumbass",
  "jackass",
];
