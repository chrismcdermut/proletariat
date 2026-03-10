# Proletariat (prlt) Marketing Plan

## Overview

Proletariat is an AI agent orchestration CLI platform that lets developers spawn, manage, and monitor AI coding agents (Claude Code, Codex) across projects. This marketing plan covers a 4-week content calendar across Twitter/X, LinkedIn, and YouTube.

## Key Value Propositions

- **Multi-agent parallel work**: Spawn multiple AI agents working on different tasks simultaneously
- **Ticket-based task management**: Integrated PM with Linear/Jira/Asana/Shortcut/Trello
- **Docker sandboxing**: Safe, isolated execution environments for AI agents
- **Session management**: Monitor, pause, resume agent sessions
- **Developer productivity**: Ship faster with AI-orchestrated development workflows

## Video Assets

1. **Anthropic Video** - Demo/presentation at Anthropic (needs editing)
2. **Boulder Netech Video** - Presentation at Boulder Netech meetup (needs editing)
3. **Kvia Cowork Video** - Presentation at Kvia Cowork space (needs editing)

---

## TWITTER/X CONTENT (15 tweets)

### Tweet 1: Launch Hook
"What if you could assign tickets to AI agents and they just... build it? That's prlt. One CLI to orchestrate Claude Code, Codex, and more across your entire codebase. Ship 10x faster."

### Tweet 2: Multi-Agent Demo
"Just spawned 5 AI agents working on 5 different tickets. In parallel. Each one sandboxed in Docker. All managed from one terminal. This is what AI-assisted development looks like in 2026."

### Tweet 3: Developer Pain Point
"Tired of context-switching between coding and project management? prlt connects your ticket board (Linear, Jira, Asana) directly to AI agents. `prlt work start TKT-042` and the agent picks it up."

### Tweet 4: Behind The Scenes
"Building an AI orchestration platform with AI agents. Yes, we use prlt to build prlt. Here's what our terminal looks like on a typical day (screenshot)"

### Tweet 5: Integration Highlight
"prlt now syncs with Asana, Linear, Jira, Shortcut, and Trello. Your AI agents work from the same backlog as your team. No more copy-pasting ticket descriptions."

### Tweet 6: Docker Sandboxing
"Every AI agent runs in its own Docker container. Full isolation. No accidental `rm -rf /`. Your codebase stays safe while agents experiment freely."

### Tweet 7: Session Management
"With prlt, you can monitor AI agents in real-time, pause them when they go off track, and resume right where they left off. It's like having a team you can actually manage."

### Tweet 8: Productivity Stats
"Our team shipped 47 PRs last week. 3 human developers. The rest? AI agents orchestrated by prlt. The future of software development isn't replacing devs—it's amplifying them."

### Tweet 9: Quick Start
"Get started with prlt in 60 seconds:
```
npm i -g @proletariat/cli
prlt init
prlt agent spawn --model claude
```
That's it. Your first AI agent is now working on your codebase."

### Tweet 10: Thread - How Multi-Agent Works
"THREAD: How do you coordinate 10 AI agents working on the same codebase without them stepping on each other? Here's how prlt solves the orchestration problem...
1/ Each agent gets its own git worktree - isolated branch, no conflicts
2/ Ticket assignment prevents duplicate work
3/ Docker containers isolate file system access
4/ A central dashboard shows all agent activity in real-time
5/ When agents finish, PRs are auto-created for human review"

### Tweet 11: Comparison
"GitHub Copilot: autocompletes your code. Cursor: AI-powered editor. prlt: AI agents that independently pick up tickets, write code, create PRs, and move on to the next task. Different level."

### Tweet 12: Use Case
"Used prlt to refactor our entire test suite yesterday. Spawned 8 agents, each handling a different test file. What would have taken a day took 45 minutes. All tests passing."

### Tweet 13: Open Source Angle
"We're building prlt in the open. Every feature request, every bug fix, every architectural decision—tracked in our own ticket system, built by our own AI agents. Dogfooding at its finest."

### Tweet 14: Developer Experience
"The best developer tools disappear into your workflow. `prlt work start TKT-051` — that's all you type. The agent reads the ticket, plans the work, writes the code, runs the tests, and opens a PR."

### Tweet 15: Vision
"In 2 years, every dev team will have AI agents on their board. Not as a novelty—as core team members handling the backlog. prlt is building that future today."

---

## LINKEDIN CONTENT (8 posts)

### LinkedIn 1: Thought Leadership - The Future of Development Teams
"The development team of 2027 won't look like the team of 2024. We're already seeing it: AI agents that can independently pick up tickets, write production code, run tests, and create pull requests. At Proletariat, we've built the orchestration layer for this new reality. Our CLI tool, prlt, lets you spawn, manage, and monitor AI coding agents across your projects. The question isn't whether AI agents will join your development team—it's whether you'll have the infrastructure to manage them effectively."

### LinkedIn 2: Product Announcement
"Excited to share what we've been building at Proletariat: a CLI platform for orchestrating AI coding agents. Think of it as the missing management layer between your project board and AI models like Claude and Codex. Key capabilities: multi-agent parallel execution, ticket system integrations (Linear, Jira, Asana, Shortcut, Trello), Docker-sandboxed environments, and real-time session management. We're not replacing developers—we're giving every developer a team of AI assistants that work from the same backlog."

### LinkedIn 3: Case Study Format
"Last week, our 3-person team shipped 47 pull requests using prlt to orchestrate AI coding agents. Here's what we learned about multi-agent development workflows: 1) Ticket granularity matters — smaller, well-defined tickets get better AI output. 2) Code review becomes your primary job — and it's the highest-leverage activity. 3) Context is everything — agents with access to your project docs and conventions produce dramatically better code. The future of developer productivity isn't about typing faster. It's about orchestrating better."

### LinkedIn 4: Technical Deep Dive
"How do you safely run 10 AI agents on the same codebase without chaos? This is the core challenge we've solved at Proletariat. Our approach: Git worktree isolation (each agent gets its own branch), Docker containerization (sandboxed file system access), ticket-based assignment (no duplicate work), and centralized monitoring (real-time dashboard). The result: AI agents that work like disciplined team members, not unsupervised interns."

### LinkedIn 5: Industry Perspective
"The biggest bottleneck in AI-assisted coding isn't the models—it's orchestration. Claude, GPT, and Codex are incredibly capable. But without proper task management, isolation, and monitoring, using them at scale is chaos. That's why we built prlt: the orchestration layer that turns AI models into managed team members. Because the future of development isn't one developer with one AI copilot. It's one developer managing a fleet of specialized agents."

### LinkedIn 6: Behind The Build
"We use prlt to build prlt. It sounds recursive, but it's the ultimate dogfooding. Every feature we ship was partially built by AI agents orchestrated through our own platform. This forces us to feel every pain point, optimize every workflow, and build the tool we actually need. If your product isn't good enough for your own team to use daily, it's not good enough for anyone."

### LinkedIn 7: Developer Productivity
"Developer productivity isn't about working more hours. It's about amplifying the hours you work. With prlt, a single developer can: spawn AI agents to handle routine tasks, parallelize independent work streams, maintain quality through automated testing and human review. The result? Small teams shipping at the pace of large ones. We believe the 10x developer of the future manages AI agents, not just writes code."

### LinkedIn 8: Vision Post
"We're entering the era of agent-augmented development teams. Within two years, most software companies will have AI agents as regular members of their development workflow—not as novelties, but as core contributors handling portions of the backlog. At Proletariat, we're building the infrastructure for this transition. Our platform handles the hard problems: orchestration, isolation, monitoring, and integration with existing workflows. The companies that figure out how to effectively manage AI agents will have a massive competitive advantage."

---

## VIDEO CONTENT PLAN

### Anthropic Video
- **Edit tasks**: Trim to highlight key demo moments, add intro/outro, add captions
- **Clips to extract**: Product demo walkthrough (30-60s), key feature highlights (15-30s each)
- **Post to**: YouTube (full), Twitter (clips), LinkedIn (clips + full)

### Boulder Netech Video
- **Edit tasks**: Trim audience Q&A, enhance audio, add presentation slides overlay where helpful, add captions
- **Clips to extract**: Best audience reactions, core pitch (60s), technical deep dive segment (2-3min)
- **Post to**: YouTube (full), Twitter (clips), LinkedIn (clips + full)

### Kvia Cowork Video
- **Edit tasks**: Trim to presentation core, add intro/outro, improve lighting/audio if needed, add captions
- **Clips to extract**: Live demo moment (30-60s), community engagement shots, key talking points
- **Post to**: YouTube (full), Twitter (clips), LinkedIn (clips + full)

---

## 4-WEEK CONTENT CALENDAR

### Week 1 (Mar 10-16): Launch & Awareness
| Day | Platform | Content |
|-----|----------|---------|
| Mon | Twitter | Tweet 1 (Launch Hook) |
| Tue | LinkedIn | Post 2 (Product Announcement) |
| Wed | Twitter | Tweet 2 (Multi-Agent Demo) |
| Thu | Twitter | Tweet 3 (Developer Pain Point) |
| Fri | LinkedIn | Post 1 (Future of Dev Teams) |

### Week 2 (Mar 17-23): Technical Depth
| Day | Platform | Content |
|-----|----------|---------|
| Mon | Twitter | Tweet 6 (Docker Sandboxing) |
| Tue | LinkedIn | Post 4 (Technical Deep Dive) |
| Wed | Twitter | Tweet 10 (Thread - Multi-Agent) |
| Thu | YouTube | Anthropic Video (full) |
| Fri | Twitter | Tweet 5 (Integration Highlight) + Anthropic clips |

### Week 3 (Mar 24-30): Social Proof & Use Cases
| Day | Platform | Content |
|-----|----------|---------|
| Mon | Twitter | Tweet 8 (Productivity Stats) |
| Tue | LinkedIn | Post 3 (Case Study) |
| Wed | Twitter | Tweet 12 (Use Case) |
| Thu | YouTube | Boulder Netech Video (full) |
| Fri | Twitter | Tweet 7 (Session Management) + Boulder Netech clips |
| Fri | LinkedIn | Post 5 (Industry Perspective) |

### Week 4 (Mar 31 - Apr 6): Vision & Community
| Day | Platform | Content |
|-----|----------|---------|
| Mon | Twitter | Tweet 13 (Open Source) |
| Tue | LinkedIn | Post 6 (Behind The Build) |
| Wed | Twitter | Tweet 14 (Developer Experience) |
| Thu | YouTube | Kvia Cowork Video (full) |
| Thu | Twitter | Tweet 9 (Quick Start) + Kvia clips |
| Fri | Twitter | Tweet 15 (Vision) |
| Fri | LinkedIn | Post 8 (Vision Post) |

### Ongoing
| Platform | Content |
|----------|---------|
| Twitter | Tweet 4 (Behind The Scenes) - post when we have good screenshot |
| Twitter | Tweet 11 (Comparison) - post during relevant industry discussion |
| LinkedIn | Post 7 (Developer Productivity) - post mid-week as filler |
