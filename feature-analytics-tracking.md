# Analytics & Metrics Tracking Spec

## Overview
**Status:** Draft
**Priority:** P1 (High) - Flying blind without data
**Estimated Effort:** 2-3 days
**ROI:** Immediate - understand what users actually do

## Problem Statement
Currently have no visibility into:
- Which features users actually use
- Where users get stuck
- What causes churn
- Which job boards are most popular

## Proposed Solution
Implement lightweight analytics using Posthog (free tier: 1M events/month)

## Quick Implementation

### Phase 1: Basic Tracking (Day 1)
**Files to modify:**
- `/apps/careerops-extension/pages/side-panel/src/SidePanel.tsx`
- `/apps/careerops-extension/pages/content/src/matches/all/index.ts`

**Events to track:**
```typescript
// Core events
track('extension_opened', { mode: 'job' | 'connection' });
track('capture_clicked', { site: hostname, mode, success: boolean });
track('job_saved', { site: hostname, fieldsUsed: [...] });
track('export_triggered', { format: 'csv' | 'notion', count: number });
track('linkedin_modal_shown', { type: 'job' | 'connection' });
```

### Phase 2: User Journey (Day 2)
```typescript
// Track funnel
track('user_journey', {
  step: 'installed' | 'signed_up' | 'first_capture' | 'first_export' | 'paid',
  timeToAction: seconds
});
```

### Phase 3: Error Tracking (Day 3)
```typescript
// Capture failures
track('error', {
  type: 'capture_failed' | 'export_failed' | 'auth_failed',
  message: error.message,
  site: hostname
});
```

## Implementation Code

```typescript
// packages/analytics/index.ts
import posthog from 'posthog-js';

export const initAnalytics = () => {
  if (import.meta.env.VITE_POSTHOG_KEY) {
    posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
      api_host: 'https://app.posthog.com',
      loaded: (posthog) => {
        if (import.meta.env.VITE_IS_DEV) posthog.opt_out_capturing();
      }
    });
  }
};

export const track = (event: string, properties?: Record<string, any>) => {
  console.log(`[Analytics] ${event}`, properties);
  if (typeof posthog !== 'undefined') {
    posthog.capture(event, properties);
  }
};
```

## Success Criteria
- [ ] Can see daily active users
- [ ] Can see feature usage funnel
- [ ] Can identify drop-off points
- [ ] Can see which job sites are most used

## Testing
1. Install extension in dev mode
2. Perform actions
3. Check Posthog dashboard for events
4. Verify no PII is sent

## Privacy Considerations
- [ ] No PII (no emails, names, job titles)
- [ ] Only behavioral data
- [ ] Add to privacy policy
- [ ] Allow opt-out

## ROI Justification
- **Cost:** Free (Posthog free tier)
- **Time:** 2-3 days
- **Value:** Stop building features nobody uses