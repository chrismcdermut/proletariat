# Telemetry & Error Tracking

Proletariat CLI includes optional anonymous error tracking to help improve stability and identify bugs.

**This feature is opt-in only** - it is disabled by default and requires explicit user consent.

## Quick Commands

```bash
# Check current status
prlt config telemetry --status

# Enable error tracking
prlt config telemetry --enable

# Disable error tracking
prlt config telemetry --disable

# Or use the config command
prlt config --set telemetry.errorTracking true
prlt config --set telemetry.errorTracking false
```

## What We Collect

When error tracking is enabled, we collect the following data when an error occurs:

| Data | Example | Purpose |
|------|---------|---------|
| Error message | `Database not found` | Identify the error type |
| Stack trace | `at openWorkspaceDatabase (index.ts:204)` | Locate bug in code |
| Command name | `work start` | Understand which feature failed |
| CLI version | `0.3.14` | Track version-specific bugs |
| Node.js version | `v20.10.0` | Identify runtime compatibility |
| Platform | `darwin` (macOS) | Track platform-specific issues |
| Execution mode | `devcontainer`, `host` | Understand execution context |

## What We NEVER Collect

We have strict privacy controls that prevent collection of:

| Never Collected | Why |
|-----------------|-----|
| File paths | Could reveal project structure |
| Repository names | Could identify private projects |
| Workspace paths | Could reveal user directories |
| Ticket content | User-generated text is private |
| Environment variables | Could contain secrets |
| API tokens/secrets | Security risk |
| Usernames | PII |
| Email addresses | PII |
| IP addresses | PII |

## Privacy Architecture

### Allowlist Approach

Instead of trying to filter out sensitive data, we use an allowlist approach:
- Only explicitly approved fields are captured
- All other data is automatically discarded

### Data Scrubbing

All captured data passes through multiple scrubbing layers:

1. **Path Scrubbing**: Any file paths (Unix, Windows, home directories) are replaced with `[REDACTED_PATHS]`
2. **Secret Scrubbing**: Patterns matching API keys, tokens, and passwords are replaced
3. **Email Scrubbing**: Email addresses are replaced with `[REDACTED_EMAILS]`
4. **Stack Trace Cleaning**: Absolute paths in stack traces are normalized to relative paths

### Example of Scrubbing

**Before scrubbing:**
```
Error: Cannot read config at /Users/john.doe/projects/my-secret-project/.proletariat/config.json
    at readConfig (/Users/john.doe/projects/proletariat/dist/lib/config.js:42:11)
```

**After scrubbing:**
```
Error: Cannot read config at [REDACTED_PATHS]
    at readConfig (dist/lib/config.js:42:11)
```

## How to Verify

The scrubbing functions are tested and you can review the implementation:

- **Scrubbing logic**: `apps/cli/src/lib/telemetry/sentry.ts`
- **Tests**: `apps/cli/test/unit/telemetry-sentry.test.ts`

## First-Run Prompt

On first use, you'll see a consent prompt asking if you want to enable error tracking. This prompt:

- Shows exactly what data is collected
- Shows what data is NEVER collected
- Defaults to "No" (opt-out)
- Is skipped in CI/non-interactive environments

## CI/Non-Interactive Environments

In automated environments (CI pipelines, scripts), error tracking:

- Is **disabled by default**
- Never prompts for consent
- Respects the `CI` environment variable
- Respects `stdin.isTTY` detection

## Data Storage

Your telemetry preference is stored in your machine config:
```
~/.proletariat/config.json
```

This setting applies to all workspaces on your machine.

## Changing Your Preference

You can change your preference at any time:

```bash
# Via interactive prompt
prlt config telemetry

# Via command line
prlt config telemetry --disable
```

## Questions?

If you have questions about our data collection practices, please:
- Open an issue: https://github.com/chrismcdermut/proletariat-cli/issues
- Review the source code: `apps/cli/src/lib/telemetry/`
