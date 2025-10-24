import SessionService from "./session.service";

class SessionCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Start the automatic session cleanup process
   */
  start(): void {
    if (this.cleanupInterval) {
      console.log("[Session Cleanup] Cleanup service already running");
      return;
    }

    console.log("[Session Cleanup] Starting automatic session cleanup service");

    // Run cleanup immediately
    this.runCleanup();

    // Schedule periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the automatic session cleanup process
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log(
        "[Session Cleanup] Stopped automatic session cleanup service"
      );
    }
  }

  /**
   * Run a single cleanup operation
   */
  private async runCleanup(): Promise<void> {
    try {
      const deletedCount = await SessionService.cleanupExpiredSessions();
      if (deletedCount > 0) {
        console.log(
          `[Session Cleanup] Cleaned up ${deletedCount} expired sessions`
        );
      }
    } catch (error) {
      console.error("[Session Cleanup] Error during cleanup:", error);
    }
  }

  /**
   * Manually trigger a cleanup operation
   */
  async manualCleanup(): Promise<number> {
    try {
      const deletedCount = await SessionService.cleanupExpiredSessions();
      console.log(
        `[Session Cleanup] Manual cleanup removed ${deletedCount} expired sessions`
      );
      return deletedCount;
    } catch (error) {
      console.error("[Session Cleanup] Error during manual cleanup:", error);
      throw error;
    }
  }
}

export default new SessionCleanupService();
