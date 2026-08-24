import {
  MASKABLE_WORDS,
  SENSITIVE_USERNAME_TERMS,
  USERNAME_BLOCKED_SUBSTRINGS,
} from "../config/profanity/wordLists";
import { normalizeForMatching } from "./profanityFilter.service";

/**
 * Username admissibility check, run at registration only.
 *
 * Why this is separate from profanityFilter.service rather than a call into it:
 * that matcher is WORD-BOUNDARY only, which is the right tradeoff for chat
 * (avoids Scunthorpe-class false positives in prose). Usernames have no word
 * boundaries — "suicidefullx4657980098721" is a single token — so boundary
 * matching would have caught 1 of the 20 names in the August abuse batch.
 *
 * So: same normalizer (leetspeak, diacritics, separator-stripping,
 * repeat-collapse — all the evasion handling is already solved there), but
 * SUBSTRING matching against curated username-specific lists.
 *
 * Pure and IO-free, so it is unit testable and cheap enough for the signup path.
 */

export type UsernameRejectionReason = "slur" | "profanity" | "sensitive";

export interface UsernameCheckResult {
  allowed: boolean;
  reason?: UsernameRejectionReason;
}

/**
 * normalizeForMatching() preserves separators — the chat matcher handles
 * spaced-out evasion ("f u c k") in its own match loop rather than in the
 * normalizer. Substring matching has no such loop, so strip anything that
 * isn't alphanumeric here to fold "s u i c i d e" and "s-u-i-c-i-d-e".
 */
const fold = (text: string): string =>
  normalizeForMatching(text).replace(/[^a-z0-9]/g, "");

/** Pre-normalize the lists once so entries fold the same way inputs do. */
const normalizeList = (words: readonly string[]): string[] =>
  words.map((word) => fold(word)).filter(Boolean);

const BLOCKED_SUBSTRINGS = normalizeList(USERNAME_BLOCKED_SUBSTRINGS);
const SENSITIVE_SUBSTRINGS = normalizeList(SENSITIVE_USERNAME_TERMS);
const PROFANITY_SUBSTRINGS = normalizeList(MASKABLE_WORDS);

/**
 * Substring matching reintroduces the false positives the chat matcher avoids
 * by using word boundaries. These are real names/words that contain a listed
 * term; checked before the substring lists and allowed through.
 *
 * Only exact (folded) whole-username matches — "scunthorpe" is fine as a name,
 * but "scunthorpefuck" should still be rejected.
 */
const ALLOWLIST = new Set(
  [
    "scunthorpe",
    "penistone",
    "lightwater",
    "clitheroe",
    "cockburn",
    "cockermouth",
    "assange",
    "bassett",
  ].map(fold)
);

/**
 * Check whether a username may be registered.
 *
 * Order matters only for which message the user sees; any hit rejects.
 * Returns `allowed: true` for empty input — length/format validation is the
 * caller's job and already runs in the controller.
 */
export function checkUsername(username: string): UsernameCheckResult {
  if (!username) return { allowed: true };

  const normalized = fold(username);
  if (!normalized) return { allowed: true };

  if (ALLOWLIST.has(normalized)) return { allowed: true };

  const hits = (list: string[]) =>
    list.some((term) => normalized.includes(term));

  if (hits(BLOCKED_SUBSTRINGS)) return { allowed: false, reason: "slur" };
  if (hits(SENSITIVE_SUBSTRINGS)) return { allowed: false, reason: "sensitive" };
  if (hits(PROFANITY_SUBSTRINGS)) return { allowed: false, reason: "profanity" };

  return { allowed: true };
}

/** Convenience wrapper for callers that don't need the reason. */
export function isUsernameAllowed(username: string): boolean {
  return checkUsername(username).allowed;
}

export default { checkUsername, isUsernameAllowed };
