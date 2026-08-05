// myth-server/src/types/featureFlag.types.ts

export interface FeatureFlag {
  feature_flag_id: string;
  key: string;
  description: string | null;
  enabled_globally: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserFeatureFlagOverride {
  feature_flag_id: string;
  user_id: string;
  key: string;
  enabled: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** A flag plus how many users have an explicit override, for the admin list. */
export interface FeatureFlagWithOverrideCount extends FeatureFlag {
  override_count: number;
}

/**
 * Why a flag resolved the way it did. Returned by the admin "evaluate" endpoint
 * so you can tell "on because global" from "on because this user is opted in"
 * without reading the tables by hand.
 */
export type FeatureFlagSource = "user_override" | "global" | "unknown_flag";

export interface FeatureFlagEvaluation {
  key: string;
  enabled: boolean;
  source: FeatureFlagSource;
}

export interface CreateFeatureFlagInput {
  key: string;
  description?: string | null;
  enabled_globally?: boolean;
}

export interface UpdateFeatureFlagInput {
  description?: string | null;
  enabled_globally?: boolean;
}

export interface SetUserOverrideInput {
  enabled: boolean;
  note?: string | null;
}
