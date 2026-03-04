# TKT-1177: Orchestrator Authentication Validation

## Problem
When starting the orchestrator via SSH (e.g., from a mobile device), the macOS keychain is locked and Claude Code cannot access stored OAuth credentials. This resulted in a stuck tmux session with an immediate authentication error.

## Solution
Added authentication validation before spawning the orchestrator session:

### 1. Host Credential Check (`hostCredentialsExist()`)
- **Location**: `apps/cli/src/lib/execution/runners.ts`
- **Checks**:
  - ANTHROPIC_API_KEY environment variable (works in all contexts, including SSH)
  - OAuth credentials in `~/.claude/.credentials.json` (keychain-based auth)
- **Returns**: `true` if either auth method is available

### 2. Pre-Launch Validation
- **Location**: `apps/cli/src/commands/orchestrator/start.ts`
- **Timing**: After executor selection, before spawning tmux session
- **Behavior**:
  - Only validates for `claude-code` executor
  - Shows clear error with three remediation options:
    1. Unlock keychain: `security unlock-keychain`
    2. Use API key: `export ANTHROPIC_API_KEY=your-api-key`
    3. Login: `claude /login`

### 3. Environment Variable Support
- **ANTHROPIC_API_KEY** is automatically inherited by the bash script that runs Claude Code
- No additional configuration needed - works out of the box
- Enables remote orchestrator management from SSH sessions

## Testing
- Unit tests: `apps/cli/test/unit/host-credentials.test.ts`
- Tests cover:
  - API key detection
  - OAuth credential detection
  - Missing credentials
  - Malformed credential files
  - Preference of API key over OAuth

## Files Changed
1. `apps/cli/src/lib/execution/runners.ts`
   - Added `hostCredentialsExist()` function
2. `apps/cli/src/commands/orchestrator/start.ts`
   - Added authentication validation before execution
   - Added clear error messages with remediation steps
3. `apps/cli/test/unit/host-credentials.test.ts`
   - Added comprehensive unit tests

## Usage
Users can now manage the orchestrator from SSH by either:
1. Unlocking the keychain before starting: `security unlock-keychain`
2. Setting ANTHROPIC_API_KEY in their shell profile
3. Logging in interactively when keychain is available

The error message guides users to the appropriate solution for their context.
