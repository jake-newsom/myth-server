/**
 * Launch onboarding reward track configuration.
 *
 * Single source of truth for the milestone definitions. The status endpoint
 * serves the `day` + `display` fields of these entries verbatim, so the client
 * panel and the server can never drift on what a milestone is worth.
 */

/**
 * Only users who registered before this instant are eligible for ANY part of
 * the track. Post-cutoff signups get nothing.
 */
export const ONBOARDING_CUTOFF_UTC = new Date("2026-10-15T00:00:00.000Z");

/** code_key of the card back seeded by migration 1787000000001. */
export const ONBOARDING_CARD_BACK_CODE_KEY = "onboarding-day-30";

/** Final milestone. Once dispatched, the track is complete and the tick stops. */
export const ONBOARDING_FINAL_DAY = 30;

/**
 * Day-7 full-art legendary weighting. Weighted toward the lowest full-art tier
 * so the top tiers stay scarce. Empty tiers fall back to the next entry, so a
 * missing pool never silently drops the reward.
 */
export const ONBOARDING_LEGENDARY_WEIGHTS: Record<string, number> = {
  "legendary+": 70,
  "legendary++": 20,
  "legendary+++": 10,
};

/** Icon kinds the client panel knows how to render. */
export type OnboardingRewardIconKind = "packs" | "card" | "card_back";

export interface OnboardingRewardIcon {
  kind: OnboardingRewardIconKind;
  amount?: number;
}

export interface OnboardingMilestone {
  /** Nth distinct login day this milestone unlocks on. */
  day: number;
  mailType: "welcome" | "reward";
  subject: string;
  content: string;
  packs?: number;
  /**
   * When true, a random full-art legendary variant is rolled at SEND time and
   * stored on the mail's reward_card_ids. It is granted later, by the normal
   * mail claim path.
   */
  randomLegendaryFullArt?: boolean;
  /** Resolved to a back_id via CardBackModel.findByCodeKey at send time. */
  cardBackCodeKey?: string;
  /** Client-facing summary. The panel renders from this, not from hardcoded art. */
  display: {
    label: string;
    icons: OnboardingRewardIcon[];
  };
}

/** Packs granted on each of the five daily milestones (days 2-6). */
const DAILY_PACK_AMOUNT = 5;

const DAILY_PACK_CONTENT = `Another day, another ${DAILY_PACK_AMOUNT} packs. Thanks for playing — here's your daily gift.`;

/** Days 2-6 are identical apart from the day number. */
function dailyPackMilestone(day: number): OnboardingMilestone {
  return {
    day,
    mailType: "reward",
    subject: `Day ${day} — Daily Packs`,
    content: DAILY_PACK_CONTENT,
    packs: DAILY_PACK_AMOUNT,
    display: {
      label: `Day ${day}`,
      icons: [{ kind: "packs", amount: DAILY_PACK_AMOUNT }],
    },
  };
}

export const ONBOARDING_MILESTONES: OnboardingMilestone[] = [
  {
    day: 1,
    mailType: "welcome",
    subject: "Welcome to Myth — 25 Packs Inside",
    content:
      "Welcome, founder! You're here at the very beginning. Take 25 packs on us and start building your collection.",
    packs: 25,
    display: {
      label: "Welcome",
      icons: [{ kind: "packs", amount: 25 }],
    },
  },
  dailyPackMilestone(2),
  dailyPackMilestone(3),
  dailyPackMilestone(4),
  dailyPackMilestone(5),
  dailyPackMilestone(6),
  {
    day: 7,
    mailType: "reward",
    subject: "Day 7 — Legendary Reward",
    content:
      "Seven days in. Here's a full-art legendary card to mark the occasion.",
    randomLegendaryFullArt: true,
    display: {
      label: "Day 7",
      icons: [{ kind: "card", amount: 1 }],
    },
  },
  {
    day: 30,
    mailType: "reward",
    subject: "Day 30 — Founder's Seal",
    content:
      "Thirty days. This card back is only for players who were here at the start. Wear it well.",
    cardBackCodeKey: ONBOARDING_CARD_BACK_CODE_KEY,
    display: {
      label: "Day 30",
      icons: [{ kind: "card_back", amount: 1 }],
    },
  },
];

/** Milestone for an exact day, if one exists. */
export function milestoneForDay(day: number): OnboardingMilestone | undefined {
  return ONBOARDING_MILESTONES.find((m) => m.day === day);
}

/** Every milestone at or below `day`, in ascending day order. */
export function milestonesUpTo(day: number): OnboardingMilestone[] {
  return ONBOARDING_MILESTONES.filter((m) => m.day <= day).sort(
    (a, b) => a.day - b.day
  );
}

/** A user is eligible for the whole track only if they registered pre-cutoff. */
export function isWithinOnboardingCutoff(createdAt: Date | string): boolean {
  const created =
    createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return created.getTime() < ONBOARDING_CUTOFF_UTC.getTime();
}
