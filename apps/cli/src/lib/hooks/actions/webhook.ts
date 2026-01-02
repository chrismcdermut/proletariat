/**
 * Webhook Action
 *
 * Sends HTTP requests when hooks fire.
 */

import { WebhookAction, HookExecutionContext } from '../types.js'
import { interpolateTemplate } from './utils.js'

export interface WebhookResult {
  success: boolean
  statusCode?: number
  responseBody?: string
  error?: string
}

/**
 * Execute a webhook action
 */
export async function executeWebhookAction(
  action: WebhookAction,
  context: HookExecutionContext
): Promise<WebhookResult> {
  const { payload, log } = context

  // Interpolate URL with payload values
  const url = interpolateTemplate(action.url, payload)
  const method = action.method || 'POST'

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'proletariat-hooks/1.0',
    ...action.headers,
  }

  // Build body - interpolate if provided, otherwise use payload
  let body: string | undefined
  if (action.body) {
    body = interpolateTemplate(action.body, payload)
  } else if (method !== 'GET') {
    body = JSON.stringify(payload)
  }

  // Set up timeout with AbortController
  const controller = new AbortController()
  const timeout = action.timeout || 30000
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? body : undefined,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const responseBody = await response.text()

    if (response.ok) {
      log(`Webhook sent successfully to ${url}`)
      return {
        success: true,
        statusCode: response.status,
        responseBody,
      }
    } else {
      log(`Webhook failed with status ${response.status}: ${url}`)
      return {
        success: false,
        statusCode: response.status,
        responseBody,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }
  } catch (error) {
    clearTimeout(timeoutId)

    const errorMessage = error instanceof Error ? error.message : String(error)
    const isTimeout = error instanceof Error && error.name === 'AbortError'

    log(`Webhook error: ${errorMessage}`)

    return {
      success: false,
      error: isTimeout ? `Request timed out after ${timeout}ms` : errorMessage,
    }
  }
}
