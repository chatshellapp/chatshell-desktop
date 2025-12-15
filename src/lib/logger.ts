import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  data?: unknown
}

class Logger {
  private currentLevel: LogLevel = 'info'
  private readonly levelPriority: Record<LogLevel, number> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
  }

  constructor() {
    this.loadLogLevel()
  }

  private async loadLogLevel() {
    try {
      const level = await invoke<string | null>('get_setting', { key: 'log_level_typescript' })
      if (level && this.isValidLogLevel(level)) {
        this.currentLevel = level as LogLevel
      }
    } catch (error) {
      // Fallback to info if we can't load the setting
      this.currentLevel = 'info'
    }
  }

  private isValidLogLevel(level: string): level is LogLevel {
    return ['trace', 'debug', 'info', 'warn', 'error'].includes(level)
  }

  async setLevel(level: LogLevel) {
    this.currentLevel = level
    try {
      await invoke('set_setting', { key: 'log_level_typescript', value: level })
    } catch (error) {
      console.error('Failed to save log level setting:', error)
    }
  }

  getLevel(): LogLevel {
    return this.currentLevel
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.currentLevel]
  }

  private formatMessage(entry: LogEntry): string {
    const dataStr = entry.data !== undefined ? ` ${JSON.stringify(entry.data)}` : ''
    return `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.message}${dataStr}\n`
  }

  private async writeToFile(entry: LogEntry) {
    try {
      const formattedMessage = this.formatMessage(entry)
      const date = new Date().toISOString().split('T')[0]
      const filename = `chatshell-frontend-${date}.log`

      await writeTextFile(`logs/${filename}`, formattedMessage, {
        baseDir: BaseDirectory.AppData,
        append: true,
      })
    } catch (error) {
      // Fallback to console if file writing fails
      console.error('Failed to write log to file:', error)
    }
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    if (!this.shouldLog(level)) {
      return
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    }

    // Write to file asynchronously
    this.writeToFile(entry).catch((error) => {
      console.error('Failed to write log:', error)
    })

    // Also log to console in development
    if (import.meta.env.DEV) {
      const consoleMethod = level === 'trace' || level === 'debug' ? 'log' : level
      console[consoleMethod](`[${level.toUpperCase()}] ${message}`, data !== undefined ? data : '')
    }
  }

  trace(message: string, data?: unknown) {
    this.log('trace', message, data)
  }

  debug(message: string, data?: unknown) {
    this.log('debug', message, data)
  }

  info(message: string, data?: unknown) {
    this.log('info', message, data)
  }

  warn(message: string, data?: unknown) {
    this.log('warn', message, data)
  }

  error(message: string, data?: unknown) {
    this.log('error', message, data)
  }
}

// Export singleton instance
export const logger = new Logger()

// Export convenience functions
export const trace = (message: string, data?: unknown) => logger.trace(message, data)
export const debug = (message: string, data?: unknown) => logger.debug(message, data)
export const info = (message: string, data?: unknown) => logger.info(message, data)
export const warn = (message: string, data?: unknown) => logger.warn(message, data)
export const error = (message: string, data?: unknown) => logger.error(message, data)
