/**
 * Credential Redaction Utilities for External Issue Spawn
 *
 * Ensures that API tokens, credentials, and other secrets are never
 * leaked into logs, CLI output, stored metadata, or error messages.
 */

/**
 * Patterns that match known credential formats.
 * Each entry has a label (for diagnostics) and a regex.
 */
const CREDENTIAL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Linear API key', pattern: /lin_api_[A-Za-z0-9_-]{10,}/g },
  { label: 'Jira API token (base64 auth)', pattern: /Basic\s+[A-Za-z0-9+/=]{20,}/g },
  { label: 'Bearer token', pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { label: 'GitHub PAT', pattern: /gh[ps]_[A-Za-z0-9]{36,}/g },
  { label: 'GitHub OAuth token', pattern: /gho_[A-Za-z0-9]{36,}/g },
  { label: 'Slack token', pattern: /xox[bprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'Generic API key', pattern: /(?:api[_-]?key|api[_-]?token|secret[_-]?key)[=:]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi },
]

/**
 * Known environment variable names that hold secrets.
 * Used to detect if their values appear in output.
 */
const SECRET_ENV_VARS = [
  'LINEAR_API_KEY',
  'PRLT_LINEAR_API_KEY',
  'PRLT_JIRA_API_TOKEN',
  'JIRA_API_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
] as const

/**
 * Redact known credential patterns from a string.
 *
 * Replaces matching substrings with `[REDACTED]`.
 *
 * @param input - String that may contain credentials
 * @returns Sanitized string with credentials replaced
 */
export function redactCredentials(input: string): string {
  let result = input
  for (const { pattern } of CREDENTIAL_PATTERNS) {
    // Reset lastIndex for global regex reuse
    pattern.lastIndex = 0
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

/**
 * Check whether a string contains any known credential patterns.
 *
 * @param input - String to scan
 * @returns Array of detected credential labels (empty if clean)
 */
export function detectCredentials(input: string): string[] {
  const found: string[] = []
  for (const { label, pattern } of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(input)) {
      found.push(label)
    }
  }
  return found
}

/**
 * Check whether a string contains any live secret values from the current environment.
 *
 * Looks up each SECRET_ENV_VAR in process.env and tests whether
 * the input contains that value literally.
 *
 * @param input - String to scan
 * @returns Array of env var names whose values appear in the input (empty if clean)
 */
export function detectEnvSecrets(input: string): string[] {
  const found: string[] = []
  for (const varName of SECRET_ENV_VARS) {
    const value = process.env[varName]
    if (value && value.length >= 8 && input.includes(value)) {
      found.push(varName)
    }
  }
  return found
}

/**
 * Scan a metadata record for credential leaks.
 *
 * Checks both keys and values for patterns that look like secrets.
 *
 * @param metadata - Key-value record to scan
 * @returns Array of issues found (empty if clean)
 */
export function auditMetadata(metadata: Record<string, string>): string[] {
  const issues: string[] = []

  for (const [key, value] of Object.entries(metadata)) {
    // Check if the key name suggests a credential
    if (/^(api[_-]?key|api[_-]?token|secret|password|credential|auth[_-]?token)$/i.test(key)) {
      issues.push(`metadata key "${key}" is a credential field name`)
    }

    // Check if the value matches credential patterns
    const detections = detectCredentials(value)
    if (detections.length > 0) {
      issues.push(`metadata value for "${key}" contains: ${detections.join(', ')}`)
    }

    // Check if the value is a live env secret
    const envLeaks = detectEnvSecrets(value)
    if (envLeaks.length > 0) {
      issues.push(`metadata value for "${key}" contains env var value from: ${envLeaks.join(', ')}`)
    }
  }

  return issues
}

/**
 * Assert that a string is free of credentials.
 * Throws if any credentials are detected.
 *
 * @param input - String to check
 * @param context - Description of what is being checked (for error message)
 * @throws Error if credentials are found
 */
export function assertNoCredentials(input: string, context: string): void {
  const pattern = detectCredentials(input)
  if (pattern.length > 0) {
    throw new Error(`Credential leak in ${context}: found ${pattern.join(', ')}`)
  }
  const env = detectEnvSecrets(input)
  if (env.length > 0) {
    throw new Error(`Env secret leak in ${context}: found values from ${env.join(', ')}`)
  }
}
