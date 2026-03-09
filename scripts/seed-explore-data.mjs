#!/usr/bin/env node

/**
 * Seed data for exploratory QA testing.
 *
 * Pre-populates the PMO with realistic projects, tickets, epics, and specs
 * so the explore-cli QA agent has content to interact with in menus.
 *
 * Usage:
 *   node scripts/seed-explore-data.mjs
 *
 * Or via prlt:
 *   prlt new   # Must have a workspace first
 *   node scripts/seed-explore-data.mjs
 */

import { execSync } from 'node:child_process'

function run(cmd) {
  try {
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 30_000 })
    return result.trim()
  } catch (error) {
    console.error(`Command failed: ${cmd}`)
    console.error(error.stderr || error.message)
    return null
  }
}

function prlt(args) {
  return run(`prlt ${args}`)
}

console.log('=== Seeding Exploratory QA Test Data ===\n')

// ── Create Projects ───────────────────────────────────────────────────
console.log('Creating projects...')
prlt('project create --name "Web Application" --description "Main web application frontend and backend" --json')
prlt('project create --name "Mobile App" --description "iOS and Android mobile applications" --json')
prlt('project create --name "Infrastructure" --description "DevOps, CI/CD, and cloud infrastructure" --json')

// ── Create Epics ──────────────────────────────────────────────────────
console.log('Creating epics...')
prlt('epic create --title "User Authentication System" --description "Complete auth system with OAuth, MFA, and session management" --project "Web Application" --json')
prlt('epic create --title "Payment Processing" --description "Stripe integration for subscriptions and one-time payments" --project "Web Application" --json')
prlt('epic create --title "Push Notifications" --description "Real-time push notification system for mobile" --project "Mobile App" --json')
prlt('epic create --title "CI/CD Pipeline" --description "Automated build, test, and deployment pipeline" --project "Infrastructure" --json')

// ── Create Tickets with variety ───────────────────────────────────────
console.log('Creating tickets...')

// Web Application tickets
const webTickets = [
  { title: 'Implement login page UI', priority: 'P1', category: 'feature', desc: 'Build the login page with email/password form, OAuth buttons, and remember me checkbox' },
  { title: 'Add OAuth2 Google provider', priority: 'P1', category: 'feature', desc: 'Integrate Google OAuth2 for social login. Must handle token refresh and account linking.' },
  { title: 'Fix session timeout not redirecting', priority: 'P0', category: 'bug', desc: 'When session expires, user sees a blank page instead of being redirected to login. Affects all authenticated routes.' },
  { title: 'Add password strength indicator', priority: 'P2', category: 'feature', desc: 'Show real-time password strength meter during registration. Use zxcvbn library.' },
  { title: 'Refactor auth middleware to use decorators', priority: 'P3', category: 'refactor', desc: 'Current auth middleware is repetitive. Move to decorator pattern for cleaner route protection.' },
  { title: 'Payment form accessibility audit', priority: 'P2', category: 'feature', desc: 'Ensure payment form meets WCAG 2.1 AA standards. Add aria labels, keyboard navigation, screen reader support.' },
  { title: 'Stripe webhook handler for failed payments', priority: 'P1', category: 'feature', desc: 'Handle payment_intent.payment_failed webhook. Notify user, retry logic, and grace period.' },
  { title: 'Dashboard loading state shows flash of content', priority: 'P2', category: 'bug', desc: 'Dashboard briefly shows stale data before loading spinner appears. Need to show skeleton loader immediately.' },
  { title: 'Add E2E tests for checkout flow', priority: 'P2', category: 'test', desc: 'Playwright tests covering: add to cart, checkout, payment, confirmation, and error cases.' },
  { title: 'Update API documentation for v2 endpoints', priority: 'P3', category: 'docs', desc: 'Document all v2 API endpoints including request/response schemas, auth requirements, and rate limits.' },
]

for (const t of webTickets) {
  prlt(`ticket create --title ${JSON.stringify(t.title)} --priority ${t.priority} --category ${t.category} --description ${JSON.stringify(t.desc)} --project "Web Application" --json`)
}

// Mobile App tickets
const mobileTickets = [
  { title: 'Push notification permission flow', priority: 'P1', category: 'feature', desc: 'Implement the native permission dialog with pre-prompt explanation screen.' },
  { title: 'Offline mode data sync', priority: 'P1', category: 'feature', desc: 'Queue mutations when offline and sync when connection restored. Handle conflicts.' },
  { title: 'App crashes on Android 12 when rotating screen', priority: 'P0', category: 'bug', desc: 'Crash report from Crashlytics: NullPointerException in MainActivity.onConfigurationChanged. Affects 15% of users.' },
  { title: 'Reduce app bundle size', priority: 'P2', category: 'performance', desc: 'Current APK is 45MB. Target under 25MB. Profile and remove unused dependencies.' },
  { title: 'Add biometric authentication', priority: 'P2', category: 'feature', desc: 'Support Face ID and Touch ID for app unlock. Fallback to PIN.' },
]

for (const t of mobileTickets) {
  prlt(`ticket create --title ${JSON.stringify(t.title)} --priority ${t.priority} --category ${t.category} --description ${JSON.stringify(t.desc)} --project "Mobile App" --json`)
}

// Infrastructure tickets
const infraTickets = [
  { title: 'Set up GitHub Actions CI pipeline', priority: 'P1', category: 'ci', desc: 'Configure GitHub Actions for: lint, test, build, deploy to staging on PR merge.' },
  { title: 'Add Terraform for AWS resources', priority: 'P2', category: 'feature', desc: 'Infrastructure as code for: VPC, ECS, RDS, S3, CloudFront. Separate staging and production.' },
  { title: 'Database migration framework', priority: 'P1', category: 'database', desc: 'Set up Flyway or similar for versioned database migrations. Support rollback.' },
  { title: 'Fix flaky test in CI causing false failures', priority: 'P1', category: 'bug', desc: 'The user-session.test.ts test fails ~20% of the time due to race condition in mock timer setup.' },
  { title: 'Add monitoring and alerting', priority: 'P2', category: 'feature', desc: 'Set up Datadog for APM, log aggregation, and alerting. Create dashboards for key metrics.' },
]

for (const t of infraTickets) {
  prlt(`ticket create --title ${JSON.stringify(t.title)} --priority ${t.priority} --category ${t.category} --description ${JSON.stringify(t.desc)} --project "Infrastructure" --json`)
}

// ── Create Specs ──────────────────────────────────────────────────────
console.log('Creating specs...')
prlt('spec create --title "Authentication Architecture" --description "Design document for the complete authentication system including OAuth, MFA, and session management" --project "Web Application" --json')
prlt('spec create --title "Payment Processing Design" --description "Architecture for Stripe integration, webhook handling, and subscription management" --project "Web Application" --json')
prlt('spec create --title "Push Notification System" --description "Technical design for cross-platform push notifications with FCM and APNS" --project "Mobile App" --json')

console.log('\n=== Seed Data Complete ===')
console.log('Created: 3 projects, 4 epics, 20 tickets, 3 specs')
console.log('Run "prlt board" to see the populated board.')
