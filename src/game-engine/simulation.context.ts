/**
 * Simulation Context Utility
 * 
 * Tracks when game logic is being executed in simulation mode (e.g., during AI lookahead)
 * to suppress debug logging that would otherwise clutter the console during AI decision making.
 */

class SimulationContext {
  private isSimulating: boolean = false;
  private simulationDepth: number = 0;

  /**
   * Enters simulation mode
   */
  enterSimulation(): void {
    this.simulationDepth++;
    this.isSimulating = true;
  }

  /**
   * Exits simulation mode
   */
  exitSimulation(): void {
    this.simulationDepth = Math.max(0, this.simulationDepth - 1);
    this.isSimulating = this.simulationDepth > 0;
  }

  /**
   * Checks if currently in simulation mode
   */
  isInSimulation(): boolean {
    return this.isSimulating;
  }

  /**
   * Gets current simulation depth
   */
  getSimulationDepth(): number {
    return this.simulationDepth;
  }

  /**
   * Executes a function within simulation context
   */
  async withSimulation<T>(fn: () => Promise<T>): Promise<T> {
    this.enterSimulation();
    try {
      return await fn();
    } finally {
      this.exitSimulation();
    }
  }

  /**
   * Conditional console.log that only logs when not in simulation
   */
  debugLog(message: string, ...args: any[]): void {
    if (!this.isSimulating) {
      console.log(message, ...args);
    }
  }

  /**
   * Force log even during simulation (for critical errors)
   */
  forceLog(message: string, ...args: any[]): void {
    console.log(`[${this.isSimulating ? 'SIM' : 'REAL'}] ${message}`, ...args);
  }
}

// Export singleton instance
export const simulationContext = new SimulationContext();
