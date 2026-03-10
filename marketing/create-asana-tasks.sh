#!/usr/bin/env bash
#
# Create Asana tasks for the Proletariat marketing plan.
#
# Usage:
#   ASANA_ACCESS_TOKEN=<token> ./create-asana-tasks.sh
#
# Or, if you already have prlt asana configured:
#   ASANA_ACCESS_TOKEN=<token> ASANA_PROJECT_GID=<gid> ./create-asana-tasks.sh
#
# The script will:
# 1. Verify authentication
# 2. Let you select a workspace and project (or use env vars)
# 3. Create all marketing tasks with due dates

set -euo pipefail

# --- Configuration ---
TOKEN="${ASANA_ACCESS_TOKEN:-${PRLT_ASANA_ACCESS_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "Error: ASANA_ACCESS_TOKEN or PRLT_ASANA_ACCESS_TOKEN must be set"
  exit 1
fi

BASE_URL="https://app.asana.com/api/1.0"
AUTH_HEADER="Authorization: Bearer $TOKEN"

# --- Helper functions ---
asana_get() {
  curl -s -H "$AUTH_HEADER" "$BASE_URL$1"
}

asana_post() {
  curl -s -X POST -H "$AUTH_HEADER" -H "Content-Type: application/json" -d "$2" "$BASE_URL$1"
}

create_task() {
  local name="$1"
  local notes="$2"
  local due_date="${3:-}"
  local section_gid="${4:-}"

  local data
  data=$(cat <<ENDJSON
{
  "data": {
    "name": "$name",
    "notes": $(echo "$notes" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))"),
    "projects": ["$PROJECT_GID"]
    ${due_date:+,"due_on": "$due_date"}
  }
}
ENDJSON
)

  local result
  result=$(asana_post "/tasks" "$data")
  local task_gid
  task_gid=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('gid',''))" 2>/dev/null || echo "")

  if [[ -n "$task_gid" && "$task_gid" != "None" ]]; then
    echo "  Created: $name (gid: $task_gid)"

    # Move to section if specified
    if [[ -n "$section_gid" ]]; then
      asana_post "/sections/$section_gid/addTask" "{\"data\":{\"task\":\"$task_gid\"}}" > /dev/null 2>&1
    fi
  else
    echo "  FAILED: $name"
    echo "    Response: $result" | head -c 200
    echo ""
  fi
}

create_section() {
  local name="$1"
  local result
  result=$(asana_post "/projects/$PROJECT_GID/sections" "{\"data\":{\"name\":\"$name\"}}")
  local gid
  gid=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('gid',''))" 2>/dev/null || echo "")
  if [[ -n "$gid" && "$gid" != "None" ]]; then
    echo "$gid"
  else
    echo ""
  fi
}

# --- Verify authentication ---
echo "Verifying Asana authentication..."
ME=$(asana_get "/users/me?opt_fields=name,email,workspaces.name")
MY_NAME=$(echo "$ME" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('name',''))" 2>/dev/null || echo "")

if [[ -z "$MY_NAME" || "$MY_NAME" == "None" ]]; then
  echo "Error: Failed to authenticate with Asana. Check your token."
  echo "Response: $ME"
  exit 1
fi
echo "Authenticated as: $MY_NAME"

# --- Select workspace ---
if [[ -z "${ASANA_WORKSPACE_GID:-}" ]]; then
  echo ""
  echo "Available workspaces:"
  echo "$ME" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for ws in data.get('data',{}).get('workspaces',[]):
    print(f\"  {ws['gid']}: {ws['name']}\")
"
  echo ""
  read -r -p "Enter workspace GID: " WORKSPACE_GID
else
  WORKSPACE_GID="$ASANA_WORKSPACE_GID"
  echo "Using workspace: $WORKSPACE_GID"
fi

# --- Select or create project ---
if [[ -z "${ASANA_PROJECT_GID:-}" ]]; then
  echo ""
  echo "Available projects in workspace:"
  PROJECTS=$(asana_get "/workspaces/$WORKSPACE_GID/projects?opt_fields=name&limit=50")
  echo "$PROJECTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for p in data.get('data',[]):
    print(f\"  {p['gid']}: {p['name']}\")
"
  echo ""
  echo "Enter project GID (or 'new' to create 'Proletariat Marketing'):"
  read -r PROJECT_GID

  if [[ "$PROJECT_GID" == "new" ]]; then
    echo "Creating project 'Proletariat Marketing'..."
    RESULT=$(asana_post "/projects" "{\"data\":{\"name\":\"Proletariat Marketing\",\"workspace\":\"$WORKSPACE_GID\",\"default_view\":\"board\"}}")
    PROJECT_GID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('gid',''))" 2>/dev/null)
    echo "Created project: $PROJECT_GID"
  fi
else
  PROJECT_GID="$ASANA_PROJECT_GID"
  echo "Using project: $PROJECT_GID"
fi

echo ""
echo "=== Creating Asana Sections ==="

# Create sections
TWITTER_SECTION=$(create_section "Twitter/X Content")
echo "Twitter/X section: $TWITTER_SECTION"

LINKEDIN_SECTION=$(create_section "LinkedIn Content")
echo "LinkedIn section: $LINKEDIN_SECTION"

VIDEO_SECTION=$(create_section "Video Content")
echo "Video section: $VIDEO_SECTION"

CALENDAR_SECTION=$(create_section "Content Calendar - Week 1 (Mar 10-16)")
echo "Calendar Week 1 section: $CALENDAR_SECTION"

CALENDAR2_SECTION=$(create_section "Content Calendar - Week 2 (Mar 17-23)")
echo "Calendar Week 2 section: $CALENDAR2_SECTION"

CALENDAR3_SECTION=$(create_section "Content Calendar - Week 3 (Mar 24-30)")
echo "Calendar Week 3 section: $CALENDAR3_SECTION"

CALENDAR4_SECTION=$(create_section "Content Calendar - Week 4 (Mar 31 - Apr 6)")
echo "Calendar Week 4 section: $CALENDAR4_SECTION"

echo ""
echo "=== Creating Twitter/X Tasks ==="

create_task "Tweet 1: Hook/Intro — prlt launch tweet" \
"Draft copy:

What if you could spawn 5 AI coding agents, give each a ticket, and watch them ship features in parallel?

That's prlt. One CLI to orchestrate them all.

github.com/anthropics/proletariat

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Product Demo
Schedule: Week 1, Monday 10am PT" \
"2026-03-10" "$TWITTER_SECTION"

create_task "Tweet 2: Pain Point — single agent bottleneck" \
"Draft copy:

The biggest bottleneck in AI-assisted coding isn't the AI. It's you.

You can only manage one conversation at a time.

prlt fixes this: spawn multiple agents, assign tickets, let them work independently. You review the PRs.

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Developer Pain Points
Schedule: Week 1, Wednesday 11am PT" \
"2026-03-12" "$TWITTER_SECTION"

create_task "Tweet 3: Demo Tease — 3 agents, 30 seconds" \
"Draft copy:

Just spawned 3 Claude agents to work on 3 different tickets simultaneously.

Total time to set up: 30 seconds.
Total time saved: 2 hours.

\`prlt agent spawn --ticket TKT-001 TKT-002 TKT-003\`

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Product Demo
Schedule: Week 1, Thursday 10am PT" \
"2026-03-13" "$TWITTER_SECTION"

create_task "Tweet 4: Integration Flex — works with your tools" \
"Draft copy:

prlt works with your existing tools:
- Linear
- Jira
- Asana
- Shortcut
- Trello

Import your tickets. Assign them to AI agents. Ship faster.

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Product Demo
Schedule: Week 2, Monday 10am PT" \
"2026-03-17" "$TWITTER_SECTION"

create_task "Tweet 5: Docker Sandboxing — isolated and safe" \
"Draft copy:

Each prlt agent runs in its own Docker container.

Isolated. Sandboxed. Safe.

No rogue AI writing to your production database. Each agent gets its own workspace, its own branch, its own world.

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Product Demo
Schedule: Week 2, Wednesday 11am PT" \
"2026-03-19" "$TWITTER_SECTION"

create_task "Tweet 6: Before/After — workflow comparison" \
"Draft copy:

Before prlt:
- Open Claude chat
- Paste context
- Wait for response
- Copy code
- Manually create PR

After prlt:
- \`prlt agent spawn --ticket TKT-042\`
- Go get coffee
- Review the PR

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Developer Pain Points
Schedule: Week 2, Thursday 10am PT" \
"2026-03-20" "$TWITTER_SECTION"

create_task "Tweet 7: Technical Insight — orchestration is hard" \
"Draft copy:

The hard part of multi-agent coding isn't the AI. It's the orchestration.

Git branches, merge conflicts, context management, session persistence, ticket tracking.

prlt handles all of it so the agents can focus on code.

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Thought Leadership
Schedule: Week 3, Monday 10am PT" \
"2026-03-24" "$TWITTER_SECTION"

create_task "Tweet 8: Dogfooding — built prlt with prlt" \
"Draft copy:

We've been dogfooding prlt to build prlt.

AI agents writing their own orchestration platform.

It's turtles all the way down.

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Behind the Scenes
Schedule: Week 3, Thursday 10am PT" \
"2026-03-27" "$TWITTER_SECTION"

create_task "Tweet 9: Comparison — fleet vs single AI" \
"Draft copy:

Cursor gives you one AI in your editor.
Copilot gives you one AI in your editor.

prlt gives you a fleet of AI agents across your entire codebase.

Different league. Different game.

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Product Demo
Schedule: Week 4, Monday 10am PT" \
"2026-03-31" "$TWITTER_SECTION"

create_task "Tweet 10: Quick Tip — ticket assignment" \
"Draft copy:

prlt tip: Use \`prlt ticket list\` to see all open work, then \`prlt agent spawn --ticket TKT-XXX\` to assign it.

Your agents get the full ticket context: description, acceptance criteria, subtasks. No copy-pasting.

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Product Demo
Schedule: Week 4, Thursday 10am PT" \
"2026-04-03" "$TWITTER_SECTION"

create_task "Tweet 11: Vision — AI agents as team members" \
"Draft copy:

In 2 years, every engineering team will have AI agents as team members.

They'll have names, assigned tickets, and sprint capacity.

The question isn't if. It's who's building the tools to manage them.

We are. It's called prlt.

---
Platform: Twitter/X
Type: Standalone tweet
Content pillar: Thought Leadership
Schedule: Week 4, Thursday 2pm PT" \
"2026-04-03" "$TWITTER_SECTION"

create_task "Tweet 12: Anthropic Video Tease" \
"Draft copy:

We showed prlt to the team at Anthropic.

Their reaction? [Attach video clip]

Full video dropping this week.

---
Platform: Twitter/X
Type: Video tease tweet
Content pillar: Product Demo
Schedule: Week 2, Friday 10am PT
Note: Requires Anthropic video clip (30-60s)" \
"2026-03-21" "$TWITTER_SECTION"

create_task "Tweet 13: Boulder Netech Video Tease" \
"Draft copy:

Demoed prlt at Boulder Netech.

Multi-agent orchestration, live ticket management, Docker sandboxing.

The crowd got it immediately. [Attach video clip]

---
Platform: Twitter/X
Type: Video tease tweet
Content pillar: Product Demo
Schedule: Week 3, Wednesday 10am PT
Note: Requires Boulder Netech video clip (30-60s)" \
"2026-03-26" "$TWITTER_SECTION"

create_task "Tweet 14: Kvia Cowork Video Tease" \
"Draft copy:

Built and shipped a feature live at Kvia Cowork using 3 parallel agents.

Start to PR in under 10 minutes. [Attach video clip]

---
Platform: Twitter/X
Type: Video tease tweet
Content pillar: Product Demo
Schedule: Week 4, Wednesday 10am PT
Note: Requires Kvia Cowork video clip (30-60s)" \
"2026-04-02" "$TWITTER_SECTION"

create_task "Tweet 15: CTA — install and star" \
"Draft copy:

Ready to 10x your dev workflow?

\`brew install proletariat\`

Or: github.com/anthropics/proletariat

Star it. Clone it. Ship with it.

---
Platform: Twitter/X
Type: Call to action tweet
Content pillar: Product Demo
Schedule: Week 4, Friday 10am PT" \
"2026-04-04" "$TWITTER_SECTION"

create_task "Twitter Thread 1: How we built prlt with prlt (5-7 tweets)" \
"Draft thread — 'How we built prlt with prlt':

1/ We used our own AI agent orchestration tool to build itself. Here's the story.

2/ We structured the work into tickets using prlt's built-in PMO. Each ticket had clear acceptance criteria and was assigned to an AI agent.

3/ Each agent ran in a Docker container with its own Git worktree. Total isolation. No stepping on each other's toes.

4/ We tracked everything through Linear integration. Tickets moved from backlog to in-progress to done, just like human work.

5/ The agents handled PRs, suggested code review improvements, and wrote tests. We just reviewed and merged.

6/ What we learned: multi-agent coordination is the hard part. The AI coding is easy. The orchestration layer is where the value is.

7/ Try it yourself: github.com/anthropics/proletariat

---
Platform: Twitter/X
Type: Thread (5-7 tweets)
Content pillar: Behind the Scenes
Schedule: Week 3, Monday 2pm PT" \
"2026-03-24" "$TWITTER_SECTION"

create_task "Twitter Thread 2: The multi-agent future of software dev (4-6 tweets)" \
"Draft thread — 'The multi-agent future of software development':

1/ Single-agent AI coding is like having one employee. Useful, but limited by throughput.

2/ Multi-agent is like having a team. But teams need management: task assignment, workspace isolation, conflict resolution, progress tracking.

3/ This is the orchestration problem. It's not about making AI smarter. It's about making AI teams work.

4/ Git branches need isolation. Contexts need separation. Tasks need clear boundaries. Review needs to be centralized.

5/ prlt solves this: ticket-based assignment, Docker isolation, parallel execution, integrated code review.

6/ The future isn't one AI helper. It's a fleet of specialized agents, orchestrated by tools that understand software development.

---
Platform: Twitter/X
Type: Thread (4-6 tweets)
Content pillar: Thought Leadership
Schedule: Week 4, Monday 2pm PT" \
"2026-03-31" "$TWITTER_SECTION"

echo ""
echo "=== Creating LinkedIn Tasks ==="

create_task "LinkedIn Post 1: Introducing Proletariat" \
"Draft copy:

Introducing Proletariat: AI Agent Orchestration for Engineering Teams

We've been building something at the intersection of AI and developer tooling.

Proletariat (prlt) is an open-source CLI that lets you spawn, manage, and monitor multiple AI coding agents in parallel. Think of it as a project manager for your AI team.

Key capabilities:
- Spawn multiple Claude/Codex agents with a single command
- Each agent gets its own Docker-sandboxed workspace
- Full integration with Linear, Jira, Asana, Shortcut, and Trello
- Ticket-based task management with acceptance criteria
- Session persistence and recovery

We've been using it internally to build prlt itself, and the productivity gains are real.

If you're an engineering leader thinking about how AI fits into your team's workflow, this is worth a look.

[Link to repo]

---
Platform: LinkedIn
Type: Announcement post
Content pillar: Product Demo
Schedule: Week 1, Tuesday 9am PT" \
"2026-03-11" "$LINKEDIN_SECTION"

create_task "LinkedIn Post 2: The Next Paradigm Shift" \
"Draft copy:

The Next Paradigm Shift in Software Development

We went from waterfall to agile. From monoliths to microservices. From on-prem to cloud.

The next shift? From single-developer workflows to AI-augmented, multi-agent teams.

Right now, most developers use AI one conversation at a time. That's like having a factory with one worker.

The future is orchestrated: multiple AI agents working in parallel, each assigned specific tasks, each operating in isolated environments, all coordinated through a central platform.

This isn't theoretical. We built it. It's called Proletariat.

The engineering teams that adopt multi-agent workflows first will ship 5-10x faster than those who don't.

The question for engineering leaders: are you building your AI infrastructure, or waiting for someone else to do it?

---
Platform: LinkedIn
Type: Thought leadership
Content pillar: Thought Leadership
Schedule: Week 1, Friday 9am PT" \
"2026-03-14" "$LINKEDIN_SECTION"

create_task "LinkedIn Post 3: I Replaced My Sprint Planning with AI Agents" \
"Draft copy:

I Replaced My Sprint Planning with AI Agents

Last week, I took our sprint backlog and assigned tickets directly to AI agents using prlt.

Each agent got:
- A ticket with description and acceptance criteria
- Its own Docker container with the codebase
- A dedicated Git branch
- Full access to the project's context

Result: 12 tickets completed in the time it would have taken to manually do 3.

The agents don't get tired. They don't context-switch. They don't have meetings.

They just write code, run tests, and submit PRs.

Is this the future of engineering management? I think it's closer than we realize.

---
Platform: LinkedIn
Type: Developer productivity story
Content pillar: Developer Pain Points
Schedule: Week 2, Tuesday 9am PT" \
"2026-03-18" "$LINKEDIN_SECTION"

create_task "LinkedIn Post 4: Docker Sandboxing Deep Dive" \
"Draft copy:

How Docker Sandboxing Makes Multi-Agent AI Development Safe

One of the biggest concerns with AI coding agents: what if they break something?

At Proletariat, we solved this with Docker-based sandboxing. Each agent runs in its own container with:
- Isolated filesystem
- Dedicated Git worktree
- Network policies
- Resource limits (CPU, memory)
- No access to production systems

This means you can let agents experiment freely without risk. If an agent goes off the rails, kill the container. No harm done.

This is the infrastructure layer that makes multi-agent development practical, not just possible.

---
Platform: LinkedIn
Type: Technical deep dive
Content pillar: Product Demo
Schedule: Week 2, Friday 9am PT" \
"2026-03-21" "$LINKEDIN_SECTION"

create_task "LinkedIn Post 5: Your AI Agents Should Use Your Existing Tools" \
"Draft copy:

Your AI Agents Should Use Your Existing Tools

One mistake I see teams make: building custom task systems for AI agents.

Your agents should work with the tools you already use. That's why prlt integrates with:
- Linear
- Jira
- Asana
- Shortcut
- Trello

Import tickets. Assign them to agents. Track progress in the same place you track human work.

AI agents aren't replacing your workflow. They're joining it.

---
Platform: LinkedIn
Type: Integration story
Content pillar: Product Demo
Schedule: Week 3, Tuesday 9am PT" \
"2026-03-25" "$LINKEDIN_SECTION"

create_task "LinkedIn Post 6: What I Learned Building an AI Agent Orchestration Platform" \
"Draft copy:

What I Learned Building an AI Agent Orchestration Platform

Building prlt taught me three counterintuitive things about AI agents:

1. The AI is the easy part. Orchestration is hard. Git conflicts, context management, session persistence — these are the real engineering challenges.

2. Agents need constraints, not freedom. Docker sandboxing and clear acceptance criteria produce better code than 'figure it out.'

3. Multi-agent is fundamentally different from single-agent. It's not just 'more of the same.' It requires new patterns for coordination, isolation, and review.

If you're building AI-assisted development tools, learn from our mistakes. The orchestration layer is where the real value lives.

---
Platform: LinkedIn
Type: Behind the scenes / lessons learned
Content pillar: Behind the Scenes
Schedule: Week 3, Friday 9am PT" \
"2026-03-28" "$LINKEDIN_SECTION"

create_task "LinkedIn Post 7: Engineering Teams in 2027" \
"Draft copy:

Engineering Teams in 2027

My prediction for engineering teams in 2 years:

- Every team has an 'AI fleet' of 5-20 agents
- Agents have assigned specializations (frontend, backend, tests, docs)
- Sprint planning includes agent capacity alongside human capacity
- Code review becomes the primary human activity
- Deployment velocity increases 10x

The bottleneck shifts from writing code to reviewing code and making architectural decisions.

This future needs tooling. That's what we're building at Proletariat.

---
Platform: LinkedIn
Type: Future vision
Content pillar: Thought Leadership
Schedule: Week 4, Tuesday 9am PT" \
"2026-04-01" "$LINKEDIN_SECTION"

create_task "LinkedIn Post 8: Watch Proletariat in Action — Video Series" \
"Draft copy:

Watch Proletariat in Action

We've been demoing prlt at events and the response has been incredible.

Dropping 3 videos this month:
1. Full demo at Anthropic — multi-agent orchestration with Claude
2. Boulder Netech presentation — live coding with AI agents
3. Kvia Cowork session — building a feature with 3 parallel agents

Each video shows real-world multi-agent development. No slides. No theory. Just shipping code.

Subscribe and follow for release dates.

---
Platform: LinkedIn
Type: Video announcement
Content pillar: Product Demo
Schedule: Week 4, Friday 9am PT" \
"2026-04-04" "$LINKEDIN_SECTION"

echo ""
echo "=== Creating Video Content Tasks ==="

create_task "Edit Anthropic Demo Video" \
"Edit the Anthropic demo video for publication.

Tasks:
- Trim to 5-8 minute highlight reel
- Add intro with prlt branding and title card
- Add outro with CTA (GitHub link, install command)
- Add captions/subtitles
- Color correct and audio normalize
- Export in 1080p for YouTube and optimized versions for social

Suggested clips to cut for shorts (30-60s each):
- The 'aha moment' when multiple agents spawn and work in parallel
- Any audience/host reactions
- The clearest product demo segment showing ticket-to-PR workflow" \
"2026-03-18" "$VIDEO_SECTION"

create_task "Post Anthropic Video to YouTube" \
"Upload the edited Anthropic demo video to YouTube.

- Title: 'Proletariat Demo at Anthropic: Multi-Agent AI Coding Orchestration'
- Description: Include product overview, key timestamps, GitHub link, install instructions
- Tags: AI coding, Claude, multi-agent, developer tools, CLI, orchestration
- Thumbnail: Create eye-catching thumbnail with prlt logo + Anthropic branding
- Add to 'Proletariat Demos' playlist
- Set premiere time: Thursday Mar 19, 12pm PT" \
"2026-03-20" "$VIDEO_SECTION"

create_task "Post Anthropic Video Clip to Twitter" \
"Post a 30-60s clip from the Anthropic demo to Twitter/X.

- Select the best 'wow moment' clip
- Add text overlay: 'Demoed prlt at Anthropic'
- Include CTA in tweet text pointing to full YouTube video
- Schedule: Same day as YouTube release or day after" \
"2026-03-21" "$VIDEO_SECTION"

create_task "Post Anthropic Video Clip to LinkedIn" \
"Post a 30-60s clip from the Anthropic demo to LinkedIn.

- Use the same or different clip than Twitter
- Write a longer-form text post to accompany the video
- Include key takeaways from the demo
- Link to full YouTube video
- Tag relevant people/companies" \
"2026-03-21" "$VIDEO_SECTION"

create_task "Edit Boulder Netech Presentation Video" \
"Edit the Boulder Netech presentation video for publication.

Tasks:
- Clean audio (event venue may have background noise)
- Add slides overlay if presenter uses slides
- Cut to 8-12 minutes (keep the best content)
- Add intro/outro with prlt branding
- Add captions/subtitles
- Export in 1080p + social-optimized versions

Suggested clips for shorts (30-60s each):
- Best audience reaction moment
- Live demo highlight showing agents in action
- Any Q&A moments that demonstrate interest/excitement" \
"2026-03-23" "$VIDEO_SECTION"

create_task "Post Boulder Netech Video to YouTube" \
"Upload the edited Boulder Netech video to YouTube.

- Title: 'Proletariat at Boulder Netech: Live Multi-Agent Coding Demo'
- Description: Event context, key timestamps, GitHub link, install instructions
- Tags: Boulder tech, developer meetup, AI agents, multi-agent coding
- Thumbnail: Event photo + prlt branding
- Add to 'Proletariat Demos' playlist
- Set premiere: Wednesday Mar 26, 12pm PT" \
"2026-03-26" "$VIDEO_SECTION"

create_task "Post Boulder Netech Video Clip to Twitter" \
"Post a 30-60s clip from Boulder Netech to Twitter/X.

- Select the most engaging moment (audience reaction or live demo)
- Include event context in tweet text
- Link to full YouTube video" \
"2026-03-26" "$VIDEO_SECTION"

create_task "Post Boulder Netech Video Clip to LinkedIn" \
"Post a 30-60s clip from Boulder Netech to LinkedIn.

- Write professional context about the event
- Tag Boulder Netech and attendees if appropriate
- Link to full YouTube video" \
"2026-03-26" "$VIDEO_SECTION"

create_task "Edit Kvia Cowork Session Video" \
"Edit the Kvia Cowork session video for publication.

Tasks:
- Keep it raw and authentic — light editing only
- Cut to 5-10 minutes
- Add minimal intro/outro
- Add captions/subtitles
- Export in 1080p + social versions

Suggested clips for shorts (30-60s each):
- The moment code actually ships live
- The agent spawn sequence
- Screen showing parallel agents working simultaneously" \
"2026-03-30" "$VIDEO_SECTION"

create_task "Post Kvia Cowork Video to YouTube" \
"Upload the edited Kvia Cowork video to YouTube.

- Title: 'Building a Feature with 3 AI Agents in 10 Minutes | Proletariat Live Session'
- Description: Context about the cowork session, timestamps, GitHub link
- Tags: live coding, AI agents, coworking, developer tools
- Thumbnail: Screen capture of agents working + prlt branding
- Set premiere: Wednesday Apr 2, 12pm PT" \
"2026-04-02" "$VIDEO_SECTION"

create_task "Post Kvia Cowork Video Clip to Twitter" \
"Post a 30-60s clip from the Kvia session to Twitter/X.

- Focus on the 'start to PR in 10 minutes' narrative
- Show the speed of multi-agent development
- Link to full YouTube video" \
"2026-04-02" "$VIDEO_SECTION"

create_task "Post Kvia Cowork Video Clip to LinkedIn" \
"Post a 30-60s clip from the Kvia session to LinkedIn.

- Frame it as a real-world productivity demonstration
- Include metrics (time saved, tickets completed)
- Link to full YouTube video" \
"2026-04-02" "$VIDEO_SECTION"

echo ""
echo "=== Creating Content Calendar Tasks ==="

# Week 1
create_task "Week 1 Mon: Post Tweet 1 (Hook/Intro) at 10am PT" \
"Publish Tweet 1 — Hook/Intro tweet introducing prlt.
See 'Tweet 1' task for draft copy.
Time: 10am PT" \
"2026-03-10" "$CALENDAR_SECTION"

create_task "Week 1 Tue: Post LinkedIn Post 1 (Announcement) at 9am PT" \
"Publish LinkedIn Post 1 — Introducing Proletariat.
See 'LinkedIn Post 1' task for draft copy.
Time: 9am PT" \
"2026-03-11" "$CALENDAR_SECTION"

create_task "Week 1 Wed: Post Tweet 2 (Pain Point) at 11am PT" \
"Publish Tweet 2 — Single agent bottleneck pain point.
See 'Tweet 2' task for draft copy.
Time: 11am PT" \
"2026-03-12" "$CALENDAR_SECTION"

create_task "Week 1 Thu: Post Tweet 3 (Demo Tease) at 10am PT" \
"Publish Tweet 3 — Demo tease with CLI command.
See 'Tweet 3' task for draft copy.
Time: 10am PT" \
"2026-03-13" "$CALENDAR_SECTION"

create_task "Week 1 Fri: Post LinkedIn Post 2 (Thought Leadership) at 9am PT" \
"Publish LinkedIn Post 2 — The Next Paradigm Shift.
See 'LinkedIn Post 2' task for draft copy.
Time: 9am PT" \
"2026-03-14" "$CALENDAR_SECTION"

# Week 2
create_task "Week 2 Mon: Post Tweet 4 (Integration Flex) at 10am PT" \
"Publish Tweet 4 — Integration showcase.
See 'Tweet 4' task for draft copy.
Time: 10am PT" \
"2026-03-17" "$CALENDAR2_SECTION"

create_task "Week 2 Tue: Post LinkedIn Post 3 (Developer Productivity) at 9am PT" \
"Publish LinkedIn Post 3 — Sprint planning with AI agents.
See 'LinkedIn Post 3' task for draft copy.
Time: 9am PT" \
"2026-03-18" "$CALENDAR2_SECTION"

create_task "Week 2 Wed: Post Tweet 5 (Docker Sandboxing) at 11am PT" \
"Publish Tweet 5 — Docker sandboxing.
See 'Tweet 5' task for draft copy.
Time: 11am PT" \
"2026-03-19" "$CALENDAR2_SECTION"

create_task "Week 2 Thu: Post Tweet 6 (Before/After) at 10am PT + Anthropic Video on YouTube at 12pm PT" \
"Two posts today:
1. Tweet 6 — Before/After comparison. See 'Tweet 6' task. Time: 10am PT
2. Anthropic Video premiere on YouTube. See 'Post Anthropic Video to YouTube' task. Time: 12pm PT" \
"2026-03-20" "$CALENDAR2_SECTION"

create_task "Week 2 Fri: Post Tweet 12 (Anthropic Video Tease) + LinkedIn Post 4 (Tech Deep Dive)" \
"Two posts today:
1. Tweet 12 — Anthropic video clip on Twitter. Time: 10am PT
2. LinkedIn Post 4 — Docker sandboxing deep dive. Time: 9am PT
Also post Anthropic video clips to Twitter and LinkedIn (see video tasks)." \
"2026-03-21" "$CALENDAR2_SECTION"

# Week 3
create_task "Week 3 Mon: Tweet 7 (Technical Insight) + Thread 1 (Built prlt with prlt)" \
"Two Twitter posts:
1. Tweet 7 — Orchestration is hard. Time: 10am PT
2. Thread 1 — How we built prlt with prlt. Time: 2pm PT
See respective tasks for draft copy." \
"2026-03-24" "$CALENDAR3_SECTION"

create_task "Week 3 Tue: LinkedIn Post 5 (Integration Story) at 9am PT" \
"Publish LinkedIn Post 5 — Your AI agents should use existing tools.
See 'LinkedIn Post 5' task for draft copy.
Time: 9am PT" \
"2026-03-25" "$CALENDAR3_SECTION"

create_task "Week 3 Wed: Boulder Netech Video + Tweet 13 at 10am PT" \
"Two posts:
1. Boulder Netech Video premiere on YouTube at 12pm PT
2. Tweet 13 — Boulder Netech video tease with clip at 10am PT
Also post clips to Twitter and LinkedIn." \
"2026-03-26" "$CALENDAR3_SECTION"

create_task "Week 3 Thu: Tweet 8 (Dogfooding) at 10am PT" \
"Publish Tweet 8 — We built prlt with prlt.
See 'Tweet 8' task for draft copy.
Time: 10am PT" \
"2026-03-27" "$CALENDAR3_SECTION"

create_task "Week 3 Fri: LinkedIn Post 6 (Behind the Scenes) at 9am PT" \
"Publish LinkedIn Post 6 — What I learned building an AI agent orchestration platform.
See 'LinkedIn Post 6' task for draft copy.
Time: 9am PT" \
"2026-03-28" "$CALENDAR3_SECTION"

# Week 4
create_task "Week 4 Mon: Tweet 9 (Comparison) + Thread 2 (Multi-agent future)" \
"Two Twitter posts:
1. Tweet 9 — Fleet vs single AI comparison. Time: 10am PT
2. Thread 2 — The multi-agent future of software dev. Time: 2pm PT
See respective tasks for draft copy." \
"2026-03-31" "$CALENDAR4_SECTION"

create_task "Week 4 Tue: LinkedIn Post 7 (Future Vision) at 9am PT" \
"Publish LinkedIn Post 7 — Engineering teams in 2027.
See 'LinkedIn Post 7' task for draft copy.
Time: 9am PT" \
"2026-04-01" "$CALENDAR4_SECTION"

create_task "Week 4 Wed: Kvia Cowork Video + Tweet 14 at 10am PT" \
"Two posts:
1. Kvia Cowork Video premiere on YouTube at 12pm PT
2. Tweet 14 — Kvia video tease with clip at 10am PT
Also post clips to Twitter and LinkedIn." \
"2026-04-02" "$CALENDAR4_SECTION"

create_task "Week 4 Thu: Tweet 10 (Quick Tip) + Tweet 11 (Vision)" \
"Two Twitter posts:
1. Tweet 10 — Quick tip on ticket assignment. Time: 10am PT
2. Tweet 11 — Vision for AI team members. Time: 2pm PT
See respective tasks for draft copy." \
"2026-04-03" "$CALENDAR4_SECTION"

create_task "Week 4 Fri: LinkedIn Post 8 (Video Series) + Tweet 15 (CTA)" \
"Two posts — campaign finale:
1. LinkedIn Post 8 — Video series announcement. Time: 9am PT
2. Tweet 15 — CTA to install and star prlt. Time: 10am PT
See respective tasks for draft copy." \
"2026-04-04" "$CALENDAR4_SECTION"

echo ""
echo "=== Done! ==="
echo "All marketing tasks have been created in Asana project: $PROJECT_GID"
echo ""
echo "Summary:"
echo "  - 17 Twitter/X tasks (15 tweets + 2 threads)"
echo "  - 8 LinkedIn tasks"
echo "  - 12 Video content tasks (3 edits + 9 platform posts)"
echo "  - 15 Content calendar tasks (4 weeks)"
echo "  - Total: 52 Asana tasks"
