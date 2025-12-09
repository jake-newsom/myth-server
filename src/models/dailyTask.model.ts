import db from "../config/db.config";

export interface DailyTaskDefinition {
  task_key: string;
  title: string;
  description: string;
  target_value: number;
  tracking_type: string;
  tracking_metadata: Record<string, any>;
  is_active: boolean;
  created_at: Date;
}

export interface DailyTaskSelection {
  selection_date: string;
  selected_task_keys: string[];
  created_at: Date;
}

export interface UserDailyTaskProgress {
  user_id: string;
  progress_date: string;
  task_progress: Record<string, number>;
  rewards_claimed: number;
  updated_at: Date;
}

export interface DailyTaskWithProgress extends DailyTaskDefinition {
  current_progress: number;
  completed: boolean;
}

const DailyTaskModel = {
  /**
   * Get all active task definitions
   */
  async getAllTaskDefinitions(): Promise<DailyTaskDefinition[]> {
    const query = `
      SELECT task_key, title, description, target_value, tracking_type, 
             tracking_metadata, is_active, created_at
      FROM daily_task_definitions
      WHERE is_active = true
      ORDER BY task_key;
    `;
    const { rows } = await db.query(query);
    return rows;
  },

  /**
   * Get task definition by key
   */
  async getTaskDefinition(taskKey: string): Promise<DailyTaskDefinition | null> {
    const query = `
      SELECT task_key, title, description, target_value, tracking_type, 
             tracking_metadata, is_active, created_at
      FROM daily_task_definitions
      WHERE task_key = $1;
    `;
    const { rows } = await db.query(query, [taskKey]);
    return rows[0] || null;
  },

  /**
   * Get task definitions by tracking type
   */
  async getTasksByTrackingType(trackingType: string): Promise<DailyTaskDefinition[]> {
    const query = `
      SELECT task_key, title, description, target_value, tracking_type, 
             tracking_metadata, is_active, created_at
      FROM daily_task_definitions
      WHERE tracking_type = $1 AND is_active = true;
    `;
    const { rows } = await db.query(query, [trackingType]);
    return rows;
  },

  /**
   * Get today's task selections
   */
  async getTodaySelection(): Promise<DailyTaskSelection | null> {
    const query = `
      SELECT selection_date::text, selected_task_keys, created_at
      FROM daily_task_selections
      WHERE selection_date = CURRENT_DATE;
    `;
    const { rows } = await db.query(query);
    return rows[0] || null;
  },

  /**
   * Get task selection for a specific date
   */
  async getSelectionByDate(date: string): Promise<DailyTaskSelection | null> {
    const query = `
      SELECT selection_date::text, selected_task_keys, created_at
      FROM daily_task_selections
      WHERE selection_date = $1::date;
    `;
    const { rows } = await db.query(query, [date]);
    return rows[0] || null;
  },

  /**
   * Create daily task selection (selects 5 random tasks)
   */
  async createDailySelection(date?: string): Promise<DailyTaskSelection> {
    const targetDate = date || new Date().toISOString().split("T")[0];

    // First check if selection already exists
    const existing = await this.getSelectionByDate(targetDate);
    if (existing) {
      return existing;
    }

    // Select 5 random active tasks
    const query = `
      INSERT INTO daily_task_selections (selection_date, selected_task_keys)
      SELECT $1::date, ARRAY(
        SELECT task_key 
        FROM daily_task_definitions 
        WHERE is_active = true 
        ORDER BY RANDOM() 
        LIMIT 5
      )
      ON CONFLICT (selection_date) DO UPDATE SET 
        selected_task_keys = EXCLUDED.selected_task_keys
      RETURNING selection_date::text, selected_task_keys, created_at;
    `;
    const { rows } = await db.query(query, [targetDate]);
    return rows[0];
  },

  /**
   * Get user's daily task progress for today
   */
  async getUserProgress(userId: string): Promise<UserDailyTaskProgress | null> {
    const query = `
      SELECT user_id, progress_date::text, task_progress, rewards_claimed, updated_at
      FROM user_daily_task_progress
      WHERE user_id = $1 AND progress_date = CURRENT_DATE;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows[0] || null;
  },

  /**
   * Get or create user's daily task progress for today
   */
  async getOrCreateUserProgress(userId: string): Promise<UserDailyTaskProgress> {
    const existing = await this.getUserProgress(userId);
    if (existing) {
      return existing;
    }

    const query = `
      INSERT INTO user_daily_task_progress (user_id, progress_date, task_progress, rewards_claimed)
      VALUES ($1, CURRENT_DATE, '{}', 0)
      ON CONFLICT (user_id, progress_date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING user_id, progress_date::text, task_progress, rewards_claimed, updated_at;
    `;
    const { rows } = await db.query(query, [userId]);
    return rows[0];
  },

  /**
   * Increment progress for a specific task
   */
  async incrementTaskProgress(
    userId: string,
    taskKey: string,
    amount: number = 1
  ): Promise<UserDailyTaskProgress> {
    const query = `
      INSERT INTO user_daily_task_progress (user_id, progress_date, task_progress, rewards_claimed)
      VALUES ($1, CURRENT_DATE, jsonb_build_object($2::text, $3::int), 0)
      ON CONFLICT (user_id, progress_date) DO UPDATE SET
        task_progress = user_daily_task_progress.task_progress || 
          jsonb_build_object($2::text, COALESCE((user_daily_task_progress.task_progress->>$2::text)::int, 0) + $3::int),
        updated_at = CURRENT_TIMESTAMP
      RETURNING user_id, progress_date::text, task_progress, rewards_claimed, updated_at;
    `;
    const { rows } = await db.query(query, [userId, taskKey, amount]);
    return rows[0];
  },

  /**
   * Set rewards claimed tier
   */
  async setRewardsClaimed(userId: string, tier: number): Promise<UserDailyTaskProgress> {
    const query = `
      UPDATE user_daily_task_progress
      SET rewards_claimed = $2, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND progress_date = CURRENT_DATE
      RETURNING user_id, progress_date::text, task_progress, rewards_claimed, updated_at;
    `;
    const { rows } = await db.query(query, [userId, tier]);
    return rows[0];
  },

  /**
   * Get today's tasks with user progress
   */
  async getTodayTasksWithProgress(userId: string): Promise<DailyTaskWithProgress[]> {
    // Get today's selection
    const selection = await this.getTodaySelection();
    if (!selection) {
      return [];
    }

    // Get user progress
    const progress = await this.getOrCreateUserProgress(userId);

    // Get task definitions for selected tasks
    const query = `
      SELECT task_key, title, description, target_value, tracking_type, 
             tracking_metadata, is_active, created_at
      FROM daily_task_definitions
      WHERE task_key = ANY($1);
    `;
    const { rows: tasks } = await db.query(query, [selection.selected_task_keys]);

    // Combine with progress
    return tasks.map((task) => ({
      ...task,
      current_progress: progress.task_progress[task.task_key] || 0,
      completed: (progress.task_progress[task.task_key] || 0) >= task.target_value,
    }));
  },

  /**
   * Get count of completed tasks for today
   */
  async getCompletedTaskCount(userId: string): Promise<number> {
    const tasks = await this.getTodayTasksWithProgress(userId);
    return tasks.filter((t) => t.completed).length;
  },

  /**
   * Check if a task is active today (selected for today)
   */
  async isTaskActiveToday(taskKey: string): Promise<boolean> {
    const selection = await this.getTodaySelection();
    if (!selection) {
      return false;
    }
    return selection.selected_task_keys.includes(taskKey);
  },

  /**
   * Get active tasks matching a tracking type for today
   */
  async getActiveTodayTasksByType(trackingType: string): Promise<DailyTaskDefinition[]> {
    const selection = await this.getTodaySelection();
    if (!selection) {
      return [];
    }

    const query = `
      SELECT task_key, title, description, target_value, tracking_type, 
             tracking_metadata, is_active, created_at
      FROM daily_task_definitions
      WHERE task_key = ANY($1) AND tracking_type = $2;
    `;
    const { rows } = await db.query(query, [selection.selected_task_keys, trackingType]);
    return rows;
  },
};

export default DailyTaskModel;

