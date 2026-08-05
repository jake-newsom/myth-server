import {
  HARD_BLOCKED_WORDS,
  MASKABLE_WORDS,
} from "../config/profanity/wordLists";

/**
 * Two-tier profanity handling. Pure and IO-free so it can be unit tested and
 * called on the socket hot path.
 *
 * Tier 1 (hard-blocked): slurs. Rejected at send time for everyone regardless
 * of any user's toggle -- never persisted, never broadcast.
 *
 * Tier 2 (maskable): general profanity. Masked only for viewers who have the
 * filter on, so the same message may render two ways in one room.
 *
 * Both tiers match against a *normalized* form of the text (lowercased,
 * diacritics stripped, leetspeak folded, runs of a repeated character
 * collapsed) to defeat trivial evasion like "f u c k", "sh1t" or "fuuuuck".
 * Masking is then applied back to the ORIGINAL string by index span, so
 * casing, spacing and punctuation survive untouched.
 *
 * Matching is word-boundary only. Substring matching produces Scunthorpe-class
 * false positives, which in a game chat are worse than a few misses.
 */

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  $: "s",
  "@": "a",
  "!": "i",
  "|": "i",
};

/**
 * A normalized string plus, for each normalized character, the index of the
 * original character it came from. This is what lets us detect a match in
 * normalized space and mask the correct span of the original text.
 */
interface Normalized {
  text: string;
  /** originIndex[i] = index in the original string of normalized char i. */
  originIndex: number[];
}

/**
 * Fold a string for matching:
 *  - strip diacritics (café -> cafe)
 *  - lowercase
 *  - map leetspeak digits/symbols to letters
 *  - drop separators so "f u c k" and "f-u-c-k" collapse
 *  - collapse runs of the same letter so "fuuuck" -> "fuck"
 *
 * Note the run-collapse means a legitimate double letter also collapses
 * ("bass" -> "bas"); word lists are matched after the same transform, so
 * entries fold consistently.
 */
function normalize(input: string): Normalized {
  const chars: string[] = [];
  const originIndex: number[] = [];

  // Walk the ORIGINAL string by code point, decomposing each character
  // individually. Doing it per-character (rather than decomposing the whole
  // string up front) keeps the mapping back to original positions exact even
  // when NFD expands one character into several, and keeps astral characters
  // such as emoji counted as a single position -- which is what the caller's
  // `[...text]` split in maskProfanity() assumes.
  const source = [...input];
  let lastKeptChar = "";

  for (let originalCursor = 0; originalCursor < source.length; originalCursor++) {
    // Drop combining marks (U+0300-U+036F) so "café" folds to "cafe".
    const decomposed = source[originalCursor]
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

    // A character can decompose to nothing (a bare combining mark) or to
    // multiple base characters (e.g. some ligatures); both map back to the
    // same original index.
    if (!decomposed) {
      continue;
    }

    const ch = decomposed[0];

    const lower = ch.toLowerCase();
    // Leet substitution runs BEFORE the separator test, so "f@ck" and "sh1t"
    // fold to letters while a genuine "!" or "@" between words still breaks
    // the token.
    const folded = LEET_MAP[lower] ?? lower;

    if (!/[a-z0-9]/.test(folded)) {
      // Anything that isn't alphanumeric after folding is a boundary. Emit a
      // single space marker so tokenization can see the break, and reset the
      // repeat-run so "aa a" doesn't collapse across it.
      if (lastKeptChar !== " ") {
        chars.push(" ");
        originIndex.push(originalCursor);
        lastKeptChar = " ";
      }
      continue;
    }

    // Collapse runs of the same character ("fuuuck" -> "fuck").
    if (folded === lastKeptChar) continue;

    chars.push(folded);
    originIndex.push(originalCursor);
    lastKeptChar = folded;
  }

  return { text: chars.join(""), originIndex };
}

/** Collapse runs of a repeated character: "faggot" -> "fagot". */
function collapseRepeats(text: string): string {
  let out = "";
  let last = "";
  for (const ch of text) {
    if (ch === last) continue;
    out += ch;
    last = ch;
  }
  return out;
}

/** Normalize a word-list entry the same way, so entries fold consistently. */
function normalizeWord(word: string): string {
  return normalize(word).text;
}

function buildWordSet(words: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const word of words) {
    const normalized = normalizeWord(word);
    if (normalized) set.add(normalized);
  }
  return set;
}

const HARD_BLOCKED = buildWordSet(HARD_BLOCKED_WORDS);
const MASKABLE = buildWordSet(MASKABLE_WORDS);

/** Longest entry across both lists, used to bound the token scan. */
const MAX_WORD_LENGTH = Math.max(
  1,
  ...[...HARD_BLOCKED, ...MASKABLE].map((w) => w.length)
);

interface NormalizedToken {
  word: string;
  /** Inclusive start index within the normalized text. */
  start: number;
  /** Exclusive end index within the normalized text. */
  end: number;
}

/**
 * Split normalized text into alphanumeric tokens. normalize() emits a single
 * space for every non-alphanumeric character, so token boundaries here are
 * exactly the word boundaries of the original text.
 */
function tokenize(normalized: string): NormalizedToken[] {
  const tokens: NormalizedToken[] = [];
  const re = /[a-z0-9]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalized)) !== null) {
    tokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

/**
 * Matching is WHOLE-TOKEN ONLY. This is the Scunthorpe guarantee: a listed
 * word buried inside a longer word ("cocktail", "assassin", "mishit",
 * "Scunthorpe") is never a match, because a real word containing profanity as
 * a substring is overwhelmingly more common in a game chat than deliberate
 * evasion by concatenation.
 *
 * Separator evasion ("f u c k", "f.u.c.k") is handled separately, by
 * reconstructing runs of single-character tokens -- see findMatches().
 */
function matchWholeToken(
  token: NormalizedToken,
  wordSet: Set<string>
): { start: number; end: number } | null {
  if (token.word.length > MAX_WORD_LENGTH) return null;
  if (!wordSet.has(token.word)) return null;
  return { start: token.start, end: token.end };
}

/**
 * Detect a listed word spelled out across separators, e.g. "f u c k" or
 * "f.a.g.g.o.t", which tokenize as a run of single-character tokens.
 *
 * Only runs of length >= 3 that join to exactly a listed word count, and the
 * whole run must be consumed. That keeps ordinary text safe: initialisms and
 * stray single letters ("I a m", "a b c") don't join to anything listed.
 *
 * Returns the spans covered, or an empty array.
 */
function matchSpacedRun(
  tokens: NormalizedToken[],
  startIdx: number,
  wordSet: Set<string>
): { matched: { start: number; end: number } | null; consumed: number } {
  // Collect the maximal run of single-character tokens from startIdx.
  let runEnd = startIdx;
  while (runEnd < tokens.length && tokens[runEnd].word.length === 1) runEnd++;

  const runLength = runEnd - startIdx;
  if (runLength < 3) return { matched: null, consumed: 0 };

  // Try the longest joinable prefix first so "f u c k e r" prefers "fucker".
  const maxLen = Math.min(runLength, MAX_WORD_LENGTH);
  for (let len = maxLen; len >= 3; len--) {
    const slice = tokens.slice(startIdx, startIdx + len);
    // Collapse repeat runs across the join, because normalize() could not:
    // the separators kept the characters in distinct tokens, so "f a g g o t"
    // joins to "faggot" while the word list holds the folded "fagot".
    const joined = collapseRepeats(slice.map((t) => t.word).join(""));
    if (!wordSet.has(joined)) continue;
    return {
      matched: { start: slice[0].start, end: slice[slice.length - 1].end },
      consumed: len,
    };
  }

  return { matched: null, consumed: 0 };
}

function findMatches(
  normalized: Normalized,
  wordSet: Set<string>
): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = [];
  const tokens = tokenize(normalized.text);

  for (let i = 0; i < tokens.length; i++) {
    const whole = matchWholeToken(tokens[i], wordSet);
    if (whole) {
      matches.push(whole);
      continue;
    }

    const spaced = matchSpacedRun(tokens, i, wordSet);
    if (spaced.matched) {
      matches.push(spaced.matched);
      i += spaced.consumed - 1;
    }
  }

  return matches;
}

/**
 * True when the text contains a tier-1 term. Callers must reject the message
 * outright: it is not persisted and not broadcast to anyone.
 */
export function containsHardBlocked(text: string): boolean {
  if (!text) return false;
  const normalized = normalize(text);
  if (!normalized.text) return false;
  return findMatches(normalized, HARD_BLOCKED).length > 0;
}

/**
 * Mask tier-2 profanity in `text`, preserving the first character of each
 * matched word and replacing the rest with asterisks ("fuck" -> "f***").
 *
 * Returns the input unchanged when nothing matched -- callers rely on
 * reference/value equality with the original as a fast path to emit a single
 * broadcast frame instead of a per-socket split emit.
 */
export function maskProfanity(text: string): string {
  if (!text) return text;

  const normalized = normalize(text);
  if (!normalized.text) return text;

  const matches = findMatches(normalized, MASKABLE);
  if (matches.length === 0) return text;

  // Translate normalized spans back to original-string spans, then mask.
  // Split by code point so astral characters (emoji) count as one position,
  // matching how normalize() advanced its cursor.
  const masked = [...text];

  for (const match of matches) {
    const originStart = normalized.originIndex[match.start];
    // The span ends at the origin of the last normalized char in the match.
    const originEndInclusive = normalized.originIndex[match.end - 1];
    if (originStart === undefined || originEndInclusive === undefined) continue;

    for (let i = originStart; i <= originEndInclusive; i++) {
      if (i === originStart) continue; // keep the first character
      const ch = masked[i];
      if (ch === undefined) continue;
      // Leave separators inside an evasive span visible ("f u c k" -> "f * * *"
      // reads oddly), so mask only the alphanumerics we actually matched.
      if (/[a-z0-9]/i.test(ch)) masked[i] = "*";
    }
  }

  return masked.join("");
}

/** Test/diagnostic seam: what the matcher actually sees. */
export function normalizeForMatching(text: string): string {
  return normalize(text).text;
}

export default {
  containsHardBlocked,
  maskProfanity,
  normalizeForMatching,
};
