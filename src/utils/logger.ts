/**
 * Production-ready logging utility
 * Replaces console.log statements with structured logging
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, any>;
  error?: Error;
}

class Logger {
  private logLevel: LogLevel;
  private isDevelopment: boolean;

  constructor() {
    this.logLevel = this.getLogLevel();
    this.isDevelopment = process.env.NODE_ENV !== "production";
  }

  private getLogLevel(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case "ERROR":
        return LogLevel.ERROR;
      case "WARN":
        return LogLevel.WARN;
      case "INFO":
        return LogLevel.INFO;
      case "DEBUG":
        return LogLevel.DEBUG;
      default:
        return this.isDevelopment ? LogLevel.DEBUG : LogLevel.INFO;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.logLevel;
  }

  private formatLog(entry: LogEntry): string {
    if (this.isDevelopment) {
      // Human-readable format for development
      let output = `[${entry.timestamp}] ${entry.level}: ${entry.message}`;
      if (entry.context) {
        output += ` ${JSON.stringify(entry.context, null, 2)}`;
      }
      if (entry.error) {
        output += `\n${entry.error.stack}`;
      }
      return output;
    } else {
      // JSON format for production (easier for log aggregation)
      return JSON.stringify(entry);
    }
  }

  private log(
    level: LogLevel,
    levelName: string,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      message,
      context,
      error,
    };

    const formattedLog = this.formatLog(entry);

    // Use appropriate console method based on level
    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedLog);
        break;
      case LogLevel.WARN:
        console.warn(formattedLog);
        break;
      default:
        console.log(formattedLog);
        break;
    }
  }

  error(message: string, context?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.ERROR, "ERROR", message, context, error);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, "WARN", message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, "INFO", message, context);
  }

  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, "DEBUG", message, context);
  }

  // Game-specific logging methods
  gameAction(
    action: string,
    gameId: string,
    userId: string,
    details?: Record<string, any>
  ): void {
    this.info(`Game action: ${action}`, {
      gameId,
      userId,
      ...details,
    });
  }

  gameError(
    message: string,
    gameId: string,
    userId?: string,
    error?: Error
  ): void {
    this.error(
      `Game error: ${message}`,
      {
        gameId,
        userId,
      },
      error
    );
  }

  // Database logging
  dbQuery(query: string, duration?: number, params?: any[]): void {
    this.debug("Database query executed", {
      query: query.substring(0, 200) + (query.length > 200 ? "..." : ""),
      duration,
      paramCount: params?.length,
    });
  }

  dbError(message: string, query?: string, error?: Error): void {
    this.error(
      `Database error: ${message}`,
      {
        query:
          query?.substring(0, 200) + (query && query.length > 200 ? "..." : ""),
      },
      error
    );
  }

  // Service logging
  serviceStart(serviceName: string, config?: Record<string, any>): void {
    this.info(`Service started: ${serviceName}`, config);
  }

  serviceStop(serviceName: string): void {
    this.info(`Service stopped: ${serviceName}`);
  }

  serviceError(serviceName: string, message: string, error?: Error): void {
    this.error(`Service error in ${serviceName}: ${message}`, undefined, error);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export default for convenience
export default logger;
