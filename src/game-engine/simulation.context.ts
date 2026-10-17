import { AsyncLocalStorage } from "async_hooks";
import { withSimulationSeed } from "./simulation.rng";

/**
 * Simulation Context Utility
 * 
 * Tracks when game logic is being executed in simulation mode (e.g., during AI lookahead)
 * to suppress debug logging that would otherwise clutter the console during AI decision making.
 */

// Depth is scoped per async call chain (AsyncLocalStorage), not per process.
// AI search yields to the event loop, so a process-global flag would mark
// real games handled in between as "simulating" and drop their achievements.
const simulationScope = new AsyncLocalStorage<{ depth: number }>();

/** Max time AI search may hold the event loop before yielding. */
const YIELD_SLICE_MS = 8;
let lastYieldAt = Date.now();

class SimulationContext {
  private get depth(): number {
    return simulationScope.getStore()?.depth ?? 0;
  }

  private get isSimulating(): boolean {
    return this.depth > 0;
  }

  /**
   * Enters simulation mode for the rest of the current async chain.
   * Prefer withSimulation; kept for tests that bracket code manually.
   */
  enterSimulation(): void {
    simulationScope.enterWith({ depth: this.depth + 1 });
  }

  /**
   * Exits simulation mode
   */
  exitSimulation(): void {
    simulationScope.enterWith({ depth: Math.max(0, this.depth - 1) });
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
    return this.depth;
  }

  /**
   * Executes a function within simulation context
   */
  withSimulation<T>(fn: () => Promise<T>, seed?: number): Promise<T> {
    return simulationScope.run({ depth: this.depth + 1 }, () =>
      seed === undefined ? fn() : withSimulationSeed(seed, fn)
    );
  }

  /**
   * Lets other sockets/requests run if search has held the event loop for
   * more than a time slice. Call from hot search loops.
   */
  async maybeYield(): Promise<void> {
    if (Date.now() - lastYieldAt < YIELD_SLICE_MS) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    lastYieldAt = Date.now();
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
