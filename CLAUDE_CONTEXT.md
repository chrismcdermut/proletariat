# Proletariat: The Vision & Current State

## The Core Magic
**"Text your company to make it work."**

You pull out your phone, text "bezos implement dark mode", and 30 seconds later get "PR ready". Work happens without touching a computer.

## What Proletariat Actually Is

### The Architecture
```
     SMS/Slack/Discord/Email
            ↓
       SWITCHBOARD (adapters)
            ↓
       ORCHESTRATOR (brain)
       /     |     \
    BEZOS   MUSK   GATES (workers)
     ↓       ↓       ↓
   [repos] [repos] [repos]
```

### Key Insights
1. **It works on ANY repo** - No restructuring needed. Just `prlt init` on any codebase
2. **The orchestrator is the magic** - You're not texting a repo, you're texting an AI manager that delegates work
3. **Multi-channel by design** - SMS, Slack, Discord, email all route through Switchboard
4. **Agents are just git worktrees** - Each "billionaire" is a git worktree with Claude Code/AI agents

## Current Implementation Status (Jan 9, 2025)

### What Exists
- ✅ Proletariat CLI (`prlt hire bezos`, `prlt fire musk`, etc.)
- ✅ Billionaire/Cars/Companies themes
- ✅ Basic switchboard.py created (Flask webhook for Twilio)
- ✅ Security docs written
- ✅ Architecture specs created

### Immediate TODOs
1. Set up Twilio account and test SMS pipeline
2. Polish demo for Denver Startup Week (Sept 17)
3. Submit to Twilio Searchlight (Sept 18 deadline)
4. Build Slack adapter
5. Create orchestrator logic (who does what)

## The Business Model

### Open Source (MIT License)
- Core CLI tool
- Orchestrator
- Switchboard adapters
- Templates

### Proprietary (Proletariat Cloud)
- Hosted agents running 24/7 in VMs
- Managed SMS/Slack integration
- No laptop needed
- $99-999/month SaaS

## The Talk Strategy (Denver Startup Week - Sept 17)

### Original Topic
"Cache Me If You Can: Accelerating AI While Reducing Cost"

### Potential Pivot
"Your Company Is A Git Repository: Running Your Startup as a State Machine"

### The Demo
1. Pull out phone on stage
2. Text: "bezos implement user authentication"
3. Show Claude Code working on laptop
4. 30 seconds later, show PR ready
5. "I just shipped a feature from my phone"

## Why This Is a Unicorn Opportunity

1. **Perfect Timing** - AI agents exist but nobody's built the orchestration layer
2. **Viral Potential** - "I hired Jeff Bezos as my git worktree" screenshots
3. **Clear Revenue** - Every developer/founder needs this
4. **Network Effects** - Each company using it becomes a template
5. **Solo Founder Friendly** - You control the entire stack

## Technical Details

### Component Names (Soviet Theme)
- **Switchboard** - Universal input layer (keeping your Vacasa term)
- **Politburo** - Orchestrator/decision brain (generic: Orchestrator)
- **Gosplan** - PMO/planning board (generic: Planner)
- **Proletariat** - The workers/agents (generic: Workforce)

### Security Approach
- Phone number allowlist for demo
- PIN codes for destructive commands
- Twilio Verify for production
- Rate limiting always

### Adapters Pattern
Each adapter (SMS, Slack, Discord) converts external input to normalized Commands, executes via Executor, and formats responses back.

## The Philosophy

### Surface Level
"I can text my company like I text my friends"

### Deeper Level
"Companies are state machines with git commits as transitions"

### Revolutionary Level
"The AI agents are the new proletariat - the working class of the digital age"

## Critical Decisions Made

1. **Name: Proletariat** - Keeping it despite being "esoteric". It's memorable and starts conversations
2. **Open Source Strategy** - Open core, closed cloud (like GitLab/Supabase model)
3. **Agent Agnostic** - Support Claude Code, Cursor, Aider, any AI coding agent
4. **Start Local** - MVP with laptop + ngrok, cloud agents come later
5. **Multi-theme** - Billionaires, Cars, Companies (not just Soviet theme)

## The Twilio Searchlight Opportunity

- Deadline: Sept 18 (day after Denver talk)
- Perfect alignment: SMS-controlled development
- Strategy: Demo at Denver, submit with live audience reaction
- Potential: $10-25K prize + massive visibility

## Files Created in This Session

1. `/bezos/pmo/specs/cloud-agent-architecture.md` - 24/7 cloud agents vision
2. `/bezos/pmo/specs/proletariat-monorepo-integration.md` - Monorepo structure
3. `/bezos/pmo/specs/proletariat-as-monorepo.md` - Proletariat AS the monorepo
4. `/bezos/pmo/specs/proletariat-component-architecture.md` - Switchboard/Orchestrator design
5. `/bezos/pmo/specs/daily-proletariat-improvement.md` - Daily improvement workflow
6. `/bezos/pmo/specs/switchboard-mvp-local.md` - This week's MVP plan
7. `/bezos/pmo/specs/twilio-searchlight-submission.md` - Competition strategy
8. `/bezos/pmo/specs/proletariat-self-build.md` - Proletariat building itself
9. `/proletariat/switchboard.py` - Actual Flask webhook server
10. `/proletariat/packages/switchboard/adapters.md` - Adapter pattern docs
11. `/proletariat/packages/switchboard/security.md` - Security layers
12. `/proletariat/packages/switchboard/slack-adapter.py` - Slack integration

## The Pitch in One Line

**"Text your company, and it does the work."**

Everything else is implementation details.

## Next Session Priorities

1. Test the SMS pipeline with real Twilio account
2. Add orchestrator logic (who does what)
3. Polish the demo sequence
4. Practice the talk
5. Record Searchlight video

## Remember

- Daily improvements to Proletariat compound into a unicorn
- The magic isn't the tech stack, it's "work happens through text"
- This could be bigger than CareerOps
- Ship every day, tweet every improvement
- The revolution will be textable ⚒️