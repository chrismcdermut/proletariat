/**
 * Notification Dispatcher
 *
 * Sends notifications through configured providers. Each provider type
 * has a handler that formats and delivers the message.
 *
 * Handlers:
 * - slack: POST to webhook URL
 * - email: POST to SendGrid API
 * - sms: POST to Twilio API
 * - terminal: Write to stdout
 * - browser_push: Placeholder (for prlt web dashboard)
 */

import type {
  NotificationProvider,
  NotificationProviderType,
  NotificationContext,
  NotificationResult,
  SlackProviderConfig,
  EmailProviderConfig,
  SmsProviderConfig,
  TerminalProviderConfig,
} from './types.js'

// =============================================================================
// Handler Type
// =============================================================================

type ProviderHandler = (
  provider: NotificationProvider,
  context: NotificationContext,
) => Promise<NotificationResult>

// =============================================================================
// Handlers
// =============================================================================

function buildMessage(context: NotificationContext): string {
  const parts: string[] = []
  if (context.event) parts.push(`[${context.event}]`)
  if (context.ticket) parts.push(`ticket=${context.ticket}`)
  if (context.pr) parts.push(`PR=#${context.pr}`)
  if (context.agent) parts.push(`agent=${context.agent}`)
  if (context.branch) parts.push(`branch=${context.branch}`)
  if (context.message) parts.push(context.message)
  return parts.join(' ') || 'Notification'
}

const handleSlack: ProviderHandler = async (provider, context) => {
  const start = Date.now()
  const config = provider.config as SlackProviderConfig

  if (!config.webhook_url) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      error: 'No webhook_url configured',
      durationMs: Date.now() - start,
    }
  }

  try {
    const message = buildMessage(context)
    const payload = {
      text: message,
      ...(config.channel ? { channel: config.channel } : {}),
      ...(config.username ? { username: config.username } : {}),
    }

    const response = await fetch(config.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return {
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
        success: false,
        error: `Slack webhook returned ${response.status}: ${await response.text()}`,
        durationMs: Date.now() - start,
      }
    }

    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: true,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

const handleEmail: ProviderHandler = async (provider, context) => {
  const start = Date.now()
  const config = provider.config as EmailProviderConfig

  if (!config.api_key || !config.from || !config.to?.length) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      error: 'Email provider requires api_key, from, and to fields',
      durationMs: Date.now() - start,
    }
  }

  try {
    const message = buildMessage(context)
    const subject = `[prlt] ${context.event || 'Notification'}`

    if (config.provider === 'sendgrid') {
      const payload = {
        personalizations: [{ to: config.to.map(email => ({ email })) }],
        from: { email: config.from },
        subject,
        content: [{ type: 'text/plain', value: message }],
      }

      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.api_key}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) {
        return {
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.type,
          success: false,
          error: `SendGrid returned ${response.status}`,
          durationMs: Date.now() - start,
        }
      }
    } else {
      // SES — use AWS SDK-compatible HTTP call
      // For now, log that SES requires aws-sdk and is not yet fully wired
      return {
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
        success: false,
        error: 'SES provider requires AWS SDK — use SendGrid for now',
        durationMs: Date.now() - start,
      }
    }

    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: true,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

const handleSms: ProviderHandler = async (provider, context) => {
  const start = Date.now()
  const config = provider.config as SmsProviderConfig

  if (!config.account_sid || !config.auth_token || !config.from || !config.to?.length) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      error: 'SMS provider requires account_sid, auth_token, from, and to fields',
      durationMs: Date.now() - start,
    }
  }

  try {
    const message = buildMessage(context)
    const results: boolean[] = []

    for (const to of config.to) {
      const body = new URLSearchParams({ Body: message, From: config.from, To: to })

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${config.account_sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${config.account_sid}:${config.auth_token}`).toString('base64')}`,
          },
          body: body.toString(),
          signal: AbortSignal.timeout(10_000),
        },
      )

      results.push(response.ok)
    }

    const allOk = results.every(Boolean)
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: allOk,
      error: allOk ? undefined : `Some SMS messages failed to send`,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }
  }
}

const handleTerminal: ProviderHandler = async (provider, context) => {
  const start = Date.now()
  const config = provider.config as TerminalProviderConfig
  const prefix = config.prefix || '[prlt:notify]'
  const message = buildMessage(context)

  // eslint-disable-next-line no-console
  console.log(`${prefix} ${message}`)

  return {
    providerId: provider.id,
    providerName: provider.name,
    providerType: provider.type,
    success: true,
    durationMs: Date.now() - start,
  }
}

const handleBrowserPush: ProviderHandler = async (provider, _context) => {
  const start = Date.now()
  // Browser push requires the prlt web dashboard to be running.
  // This is a placeholder that succeeds silently when no endpoint is configured.
  return {
    providerId: provider.id,
    providerName: provider.name,
    providerType: provider.type,
    success: true,
    durationMs: Date.now() - start,
  }
}

// =============================================================================
// Handler Registry
// =============================================================================

const HANDLERS: Record<NotificationProviderType, ProviderHandler> = {
  slack: handleSlack,
  email: handleEmail,
  sms: handleSms,
  terminal: handleTerminal,
  browser_push: handleBrowserPush,
}

// =============================================================================
// Dispatcher
// =============================================================================

/**
 * Send a notification through a configured provider.
 */
export async function dispatchNotification(
  provider: NotificationProvider,
  context: NotificationContext,
): Promise<NotificationResult> {
  const handler = HANDLERS[provider.type]
  if (!handler) {
    return {
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.type,
      success: false,
      error: `Unknown provider type: ${provider.type}`,
      durationMs: 0,
    }
  }
  return handler(provider, context)
}

/**
 * Send notifications through multiple providers.
 * Returns results for all providers (does not short-circuit on failure).
 */
export async function dispatchNotifications(
  providers: NotificationProvider[],
  context: NotificationContext,
): Promise<NotificationResult[]> {
  return Promise.all(providers.map(p => dispatchNotification(p, context)))
}

/**
 * Build a human-readable notification message from context.
 * Exported for testing and reuse.
 */
export { buildMessage }
