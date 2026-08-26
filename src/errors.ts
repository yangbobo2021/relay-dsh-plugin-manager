export type PluginManagerErrorCode =
  | 'INVALID_SOURCE'
  | 'INVALID_NPM_SPEC'
  | 'INVALID_NPM_VERSION'
  | 'INVALID_GITHUB_SPEC'
  | 'INVALID_GITHUB_REF'
  | 'IMMUTABLE_SOURCE_REQUIRED'
  | 'NETWORK_ERROR'
  | 'SOURCE_HTTP_ERROR'
  | 'INVALID_SOURCE_METADATA'
  | 'INVALID_PLUGIN_MANIFEST'
  | 'NOT_DSH_PLUGIN'
  | 'PACKAGE_NAME_MISMATCH'
  | 'NPM_INTEGRITY_MISSING'
  | 'INVALID_SEARCH_QUERY'
  | 'INVALID_ACTION'
  | 'DUPLICATE_SEARCH_PROVIDER'
  | 'PROFILE_READ_FAILED'
  | 'PROFILE_WRITE_FAILED'
  | 'PLUGIN_NOT_INSTALLED'
  | 'PLUGIN_ALREADY_INSTALLED'
  | 'ENABLEMENT_UNSUPPORTED'
  | 'ENABLEMENT_CONFLICT'
  | 'PROTECTED_PLUGIN'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_EXPIRED'
  | 'CONFIRMATION_REPLAYED'
  | 'PLAN_STALE'
  | 'OPERATION_BUSY'
  | 'OPERATION_NOT_FOUND'
  | 'DSH_COMMAND_FAILED'
  | 'POSTCONDITION_FAILED'
  | 'RESTART_UNAVAILABLE'

export class PluginManagerError extends Error {
  readonly code: PluginManagerErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: PluginManagerErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'PluginManagerError'
    this.code = code
    this.details = details
  }
}

export function fail(
  code: PluginManagerErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new PluginManagerError(code, message, details)
}
