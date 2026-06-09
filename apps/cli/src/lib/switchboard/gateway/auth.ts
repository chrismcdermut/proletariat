/**
 * Gateway Auth — Verifies inbound messages from external platforms.
 *
 * Provides signature verification and user authorization for
 * Slack, Discord, and WhatsApp webhook payloads.
 *
 * See: PRLT-1372
 */

import * as crypto from 'node:crypto'
import type { AuthResult, GatewayCredentials, GatewayPlatform } from './types.js'

// =============================================================================
// Signature Verification
// =============================================================================

/**
 * Verify a Slack request signature.
 *
 * Slack signs requests using HMAC-SHA256 with the signing secret.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  headers: Record<string, string>,
  body: string,
): boolean {
  const timestamp = headers['x-slack-request-timestamp']
  const signature = headers['x-slack-signature']

  if (!timestamp || !signature) return false

  // Reject requests older than 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false

  const baseString = `v0:${timestamp}:${body}`
  const hmac = crypto.createHmac('sha256', signingSecret)
  hmac.update(baseString)
  const computed = `v0=${hmac.digest('hex')}`

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed),
  )
}

/**
 * Verify a Discord request signature.
 *
 * Discord uses Ed25519 signatures on interactions.
 * See: https://discord.com/developers/docs/interactions/receiving-and-responding
 */
export function verifyDiscordSignature(
  publicKey: string,
  headers: Record<string, string>,
  body: string,
): boolean {
  const signature = headers['x-signature-ed25519']
  const timestamp = headers['x-signature-timestamp']

  if (!signature || !timestamp) return false

  try {
    const message = Buffer.from(timestamp + body)
    const sig = Buffer.from(signature, 'hex')
    const key = Buffer.from(publicKey, 'hex')

    return crypto.verify(null, message, { key, format: 'der', type: 'spki' }, sig)
  } catch {
    // Ed25519 verification requires crypto support — return false on error
    return false
  }
}

/**
 * Verify a WhatsApp webhook signature.
 *
 * Meta signs webhook payloads using HMAC-SHA256 with the app secret.
 * See: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */
export function verifyWhatsAppSignature(
  appSecret: string,
  headers: Record<string, string>,
  body: string,
): boolean {
  const signature = headers['x-hub-signature-256']
  if (!signature) return false

  const expected = signature.replace('sha256=', '')
  const hmac = crypto.createHmac('sha256', appSecret)
  hmac.update(body)
  const computed = hmac.digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(computed),
  )
}

// =============================================================================
// Auth Verification
// =============================================================================

/**
 * Verify an inbound message against credentials.
 *
 * Checks:
 * 1. Signature verification (if signing secret is configured)
 * 2. User authorization (if allowedUserIds is configured)
 */
export function verifyAuth(
  credentials: GatewayCredentials,
  headers: Record<string, string>,
  body: string,
  senderId?: string,
): AuthResult {
  // Step 1: Signature verification (if configured)
  if (credentials.signingSecret) {
    const signatureValid = verifySignature(
      credentials.platform,
      credentials.signingSecret,
      headers,
      body,
    )

    if (!signatureValid) {
      return {
        authorized: false,
        reason: `Invalid ${credentials.platform} signature`,
      }
    }
  }

  // Step 2: User authorization (if configured)
  if (credentials.allowedUserIds && credentials.allowedUserIds.length > 0 && senderId) {
    if (!credentials.allowedUserIds.includes(senderId)) {
      return {
        authorized: false,
        reason: `User ${senderId} is not in the allowed users list`,
        userId: senderId,
      }
    }
  }

  return {
    authorized: true,
    userId: senderId,
  }
}

/**
 * Dispatch signature verification to the platform-specific implementation.
 */
function verifySignature(
  platform: GatewayPlatform,
  secret: string,
  headers: Record<string, string>,
  body: string,
): boolean {
  switch (platform) {
    case 'slack':
      return verifySlackSignature(secret, headers, body)
    case 'discord':
      return verifyDiscordSignature(secret, headers, body)
    case 'whatsapp':
      return verifyWhatsAppSignature(secret, headers, body)
  }
}
