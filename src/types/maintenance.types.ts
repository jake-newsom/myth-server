// myth-server/src/types/maintenance.types.ts

export interface MaintenanceWindow {
  maintenance_window_id: string;
  message: string;
  starts_at: string;
  /** NULL = open-ended; the window stays active until ended explicitly. */
  ends_at: string | null;
  /** Set the first time the window was seen active and in-flight games aborted. */
  games_aborted_at: string | null;
  games_aborted_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMaintenanceWindowInput {
  message?: string;
  /** Defaults to now — omit to start maintenance immediately. */
  starts_at?: string;
  ends_at?: string | null;
  created_by?: string | null;
}

export interface UpdateMaintenanceWindowInput {
  message?: string;
  starts_at?: string;
  ends_at?: string | null;
}

/**
 * What the gate needs to know, shaped for the caller rather than the table.
 * `window` is present only when `active` is true, so the message can be
 * surfaced without a second lookup.
 */
export interface MaintenanceStatus {
  active: boolean;
  message: string | null;
  /** When the current window is expected to lift. NULL when open-ended. */
  ends_at: string | null;
  window: MaintenanceWindow | null;
}
