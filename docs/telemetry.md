# Telemetry & Error Tracking

Proletariat CLI includes optional error tracking to help improve the software. This document explains what data is collected, how it's used, and how to control it.

## Overview

Error tracking is **opt-in and disabled by default**. When enabled, the CLI sends anonymous error reports to help identify and fix bugs.

## Quick Reference

```bash
# Check current telemetry settings
prlt config telemetry --list

# Enable error tracking
prlt config telemetry --set errorTracking true

# Disable error tracking
prlt config telemetry --set errorTracking false
```

## What We Collect

When error tracking is enabled and an error occurs, we collect:

| Data | Example | Purpose |
|------|---------|---------|
| Command name | `work start`, `ticket list` | Identify which commands have issues |
| CLI version | `0.3.17` | Track if bugs are version-specific |
| Node.js version | `v20.10.0` | Identify runtime compatibility issues |
| Platform/OS | `darwin`, `linux` | Identify platform-specific bugs |
| Environment | `production`, `development` | Separate dev issues from production |
| Sanitized error messages | `TypeError: Cannot read properties...` | Understand what went wrong |
| Sanitized stack traces | `at Object.<anonymous> (/[REDACTED]/src/main.ts:10:5)` | Locate bugs in the codebase |

## What We NEVER Collect

We take privacy seriously. The following data is **never** collected:

- **File paths** - All paths are scrubbed (e.g., `/Users/john/` becomes `/Users/[REDACTED]/`)
- **Repository names** - Repository and workspace names are never sent
- **Ticket content** - Ticket titles, descriptions, and acceptance criteria are never sent
- **User-generated text** - Any text you write is never captured
- **Environment variables** - Variables containing secrets are scrubbed
- **API keys and tokens** - GitHub tokens, API keys, and similar credentials are detected and removed
- **Email addresses** - Any email addresses in error messages are redacted
- **IP addresses** - External IP addresses are redacted (localhost is preserved)
- **Personal identifiers** - No usernames, account IDs, or personal information

## Privacy Implementation

### Allowlist Approach

Rather than trying to block sensitive data, we use an **allowlist approach**: only explicitly approved fields are ever sent. Any data not on the allowlist is automatically excluded.

### Data Scrubbing

Before any error report is sent, it passes through multiple scrubbing filters:

1. **Path scrubbing** - Removes usernames from file paths
2. **Credential detection** - Removes GitHub tokens, API keys, SSH keys
3. **PII detection** - Removes email addresses and IP addresses
4. **Secret detection** - Removes environment variables containing KEY, SECRET, TOKEN, or PASSWORD

### Example Transformations

| Before | After |
|--------|-------|
| `/Users/john/projects/secret-repo/src/index.ts` | `/Users/[REDACTED]/projects/secret-repo/src/index.ts` |
| `ghp_1234567890abcdefghijklmnopqrstuvwxyz` | `[REDACTED_GH_TOKEN]` |
| `API_KEY=sk-abc123def456` | `API_KEY=[REDACTED]` |
| `admin@company.com` | `[REDACTED_EMAIL]` |
| `192.168.1.100` | `[REDACTED_IP]` |

## First-Run Consent

When you first use the CLI in an interactive terminal, you'll be prompted:

```
Help improve Proletariat CLI
─────────────────────────────

Would you like to help improve prlt by sending anonymous error reports?

What we collect (only when errors occur):
  • Command name and execution mode
  • CLI version, Node.js version, OS
  • Sanitized error messages and stack traces

What we NEVER collect:
  • File paths, repository names, or workspace paths
  • Ticket content or user-generated text
  • Environment variables or secrets

You can change this anytime: prlt config telemetry

? Enable anonymous error tracking?
❯ Yes - Help improve prlt
  No - Keep error tracking disabled
```

## CI/Non-Interactive Environments

In CI environments or when stdin/stdout are not TTY:

- The consent prompt is **never shown**
- Error tracking defaults to **disabled**
- No automatic data is sent

To enable error tracking in CI, explicitly set it:

```bash
prlt config telemetry --set errorTracking true
```

## Environment Variables

| Variable | Effect |
|----------|--------|
| `CI` or `CONTINUOUS_INTEGRATION` | Disables consent prompts |
| `PRLT_NO_TELEMETRY_PROMPT=true` | Disables consent prompts |
| `PRLT_SENTRY_DSN` | Custom Sentry DSN (for development) |
| `PRLT_DEV=true` | Marks environment as development |
| `NODE_ENV=test` | Disables all telemetry |

## Configuration Storage

Telemetry settings are stored in your machine config:

```
~/.proletariat/config.json
```

The telemetry section looks like:

```json
{
  "telemetry": {
    "errorTracking": false,
    "hasPromptedForConsent": true,
    "consentTimestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

## Disabling Permanently

To permanently disable error tracking:

```bash
prlt config telemetry --set errorTracking false
```

Or manually edit `~/.proletariat/config.json`:

```json
{
  "telemetry": {
    "errorTracking": false,
    "hasPromptedForConsent": true
  }
}
```

## Questions?

If you have questions about telemetry or privacy, please open an issue at:
https://github.com/chrismcdermut/proletariat-cli/issues
