/**
 * Structured logger utility.
 * 
 * - `debug()`: Only logs in development (silenced in production)
 * - `info()`: Always logs (for important operational messages)
 * - `warn()`: Always logs warnings
 * - `error()`: Always logs errors
 * 
 * Usage:
 * ```ts
 * import { logger } from '@/lib/logger'
 * logger.debug('[generate]', 'Processing started', { id })
 * logger.error('[generate]', 'Processing failed', error)
 * ```
 */

const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  /** Debug logs - only in development. Use for verbose tracing. */
  debug: (...args: unknown[]) => {
    if (isDev) console.log(...args)
  },

  /** Info logs - always visible. Use for important operational messages. */
  info: (...args: unknown[]) => {
    console.log(...args)
  },

  /** Warning logs - always visible. Use for recoverable issues. */
  warn: (...args: unknown[]) => {
    console.warn(...args)
  },

  /** Error logs - always visible. Use for failures and exceptions. */
  error: (...args: unknown[]) => {
    console.error(...args)
  },
}
