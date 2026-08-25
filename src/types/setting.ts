// Setting types are generated from Rust models via ts-rs.
// Run `pnpm types:generate` in src-tauri to regenerate.

export type { Setting } from './generated/Setting'
export type { SearchProviderInfo as SearchProvider } from './generated/SearchProviderInfo'

// Known search provider IDs
export type SearchProviderId = 'duckduckgo' | 'yahoo' | 'baidu'

// Web Fetch types
export type WebFetchMode = 'local' | 'api'
export type WebFetchLocalMethod = 'auto' | 'fetch' | 'headless'
export type WebFetchApiProvider = 'jina'

// Logging types
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'
