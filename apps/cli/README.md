# ⚒️ PROLETARIAT CLI

> **Workspace Manager for Parallel AI Development**  
> *Run multiple Cursor sessions, Claude Code instances, or CLI agents simultaneously on one machine - each working on different features without conflicts*

**Scale your solo development: Multiple AI sessions, parallel workspaces, all on your local machine!** 

---

## What Is This?

**PROLETARIAT CLI** implements the design pattern for running multiple AI coding sessions in parallel on a single machine. Each "agent" is a persistent workspace (git worktree) where AI tools or developers can work continuously - not just for single features:

- 🤖 **Persistent AI workspaces** - Let Claude Code live in the "bezos" workspace for weeks, handling all auth tasks
- 🔀 **No constant branching** - Each workspace can handle multiple related features over time
- 🎯 **Domain-focused development** - One workspace for frontend, another for API, another for testing

Using memorable themes, you manage your agent workforce:
- 💰 **Billionaires** become your coding workforce (Bezos, Musk, Gates)
- 🚗 **Toyotas** drive your development forward (Prius, Tacoma, Tundra)
- 🏢 **Companies** form your development portfolio (Apple, Google, Microsoft)

Each workspace is a dedicated git worktree on your local machine. Run 3 Cursor instances editing different features, or quickly switch between workspaces without losing context!

---

## 💡 The Design Pattern

**Problem:** AI coding tools work in a single directory. Want to work on multiple features? You're stuck with stashing, branching, and context switching.

**Solution:** PROLETARIAT creates isolated agent directories on your machine where you can run multiple AI sessions:

```
your-company-workspace/  (recommended layout)
├── your-repo/              # Your original repo
├── your-repo-staff/
│   ├── bezos/    → Claude Code 1: Building authentication
│   ├── musk/     → Claude Code 2: Implementing AI features  
│   ├── gates/    → Cursor: Refactoring database
│   ├── jobs/     → Codex CLI 1: Writing test suite
│   └── cook/     → Codex CLI 2: Fixing security issues
```

**Result:** One developer, 5 agent directories, 0 conflicts. Work on multiple features simultaneously or let AI agents handle different tasks!

![Multi-Agent Development in Action](https://github.com/chrismcdermut/proletariat-cli/raw/main/assets/multi-agent-workspace.png)
*Three Claude Code instances working in parallel: `andreesen` on Feature A, `jobs` on Feature B, and `zuck` fixing a reported bug (no musk, he was fired)* 

---

## 🎯 Core Features

### ⚡ **Zero Configuration**
Just `prlt init` and you're ready to go. Zero configuration required.

### 🎨 **Three Fun Themes** *(Custom themes coming soon!)*
- **💰 Billionaires**: Hire/fire billionaire workers in `../project-staff/`
- **🚗 Cars**: Drive/park cars in your `../project-garage/` 
- **🏢 Companies**: Buy/sell companies in your `../project-portfolio/`

### 🔀 **Multiple Agent Directories in Your Workspace**
Each agent gets their own clean git worktree on your local filesystem. Run multiple Cursor windows, Claude Code instances, or just keep different features open - each agent in their own directory, no context switching needed.

---

## 🚀 Quick Start

```bash
# Install
npm install -g @proletariat/cli

# Initialize with interactive theme selection
cd your-project
prlt init  # Prompts you to choose: billionaires, toyotas, or companies

# Create worktrees with themed commands
prlt hire bezos musk        # Billionaires theme
prlt drive 4runner prius      # Cars theme  
prlt buy apple microsoft    # Companies theme

# Check status
prlt staff                   # Billionaires theme
prlt garage                  # Cars theme
prlt portfolio               # Companies theme

# Remove worktrees  
prlt fire gates             # Billionaires theme
prlt park honda             # Cars theme
prlt sell nvidia            # Companies theme
```

### 🏗️ Flexible Agent Workspace Layouts

**Workspace Layout (Recommended)** - Group repositories and agents under one parent directory:
```bash
# IMPORTANT: Run prlt init inside EACH repository you want to manage
cd frontend-repo && prlt init --workspace acme-corp
cd ../backend-repo && prlt init --workspace acme-corp  

# Each repo needs its own initialization since worktrees are per-repository
```

Creates this organized structure to hold multi-repo projects:
```
acme-corp-workspace/        # Workspace containing all repos and agents
├── frontend-repo/          (main frontend repository)
├── frontend-repo-staff/    (frontend billionaire agents)
│   ├── bezos/      (e.g., Claude Code instance 1)
│   ├── musk/       (e.g., Claude Code instance 2)
│   └── gates/      (e.g., Cursor)
├── backend-repo/           (main backend repository)  
└── backend-repo-staff/     (backend billionaire agents)
    ├── cook/       (e.g., Codex CLI 1)
    ├── jobs/       (e.g., Codex CLI 2)
    └── buffett/    (e.g., Claude Code instance 2)
```

Each repository maintains its own `.proletariat/config.json` since worktrees are per-repository.

**Default Layout** - Agents as siblings to your repository:
```
parent-dir/
├── your-repo/          (main repository)
└── your-repo-staff/    (billionaire agents)
    ├── bezos/      (e.g., Claude Code instance 1)
    ├── musk/       (e.g., Claude Code instance 2)
    └── gates/      (e.g., Cursor)
    OR
└── your-repo-garage/   (toyota agents)
    ├── camry/      (e.g., Codex CLI 1)
    ├── prius/      (e.g., Codex CLI 2)
    └── tacoma/     (e.g., Cursor)
    OR
└── your-repo-portfolio/ (company agents)
    ├── apple/      (e.g., Claude Code)
    ├── google/     (e.g., Cursor instance 1)
    └── microsoft/  (e.g., Cursor instance 2)
```

**Custom Location** - Point agents anywhere you want:
```bash
prlt init --workspace-root ~/code/agents
# Creates agents in your specified directory
```

---

## 💼 The Billionaire Experience

```bash
$ prlt init
⚒️  PROLETARIAT ⚒️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Billionaire Staff 💰
⚒️ Making billionaires work as your git worktrees!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ prlt hire bezos musk
💰 Hiring billionaire workers
💰 BEZOS: Ready to work at ../your-project-staff/bezos
💰 MUSK: Ready to work at ../your-project-staff/musk

$ prlt staff
💰 Current billionaire staff
💰 BEZOS: ✅ ACTIVE - ../your-project-staff/bezos
    📝 Branch: agent/bezos/work
💰 MUSK: ✅ ACTIVE - ../your-project-staff/musk  
    📝 Branch: agent/musk/work

Workers of the codebase, unite! ✊
```

---

## 🎨 Choose Your Theme

### 💰 Billionaires (Default)
Make the ultra-wealthy work for YOU!

```bash
prlt init --theme=billionaires
prlt hire bezos musk gates buffett
prlt fire zuckerberg        # You're fired!
prlt staff                  # Check your workers
```

**Agents**: altman, daramodei, danamodei, andreesen, arnault, benioff, bezos, blakely, bloomberg, branson, brin, buffett, carmack, chesky, cook, dean, dorsey, ellison, gates, horowitz, huang, jobs, kalanick, karpathy, lecun, ma, murati, munger, musk, nadella, ng, oprah, page, perkins, sandberg, sutskever, swift, whitney, wojcicki, zuck  
**Directory**: `../[project]-staff/`

### 🚗 Toyotas  
Manufacturing's finest keeping your fleet humming.

```bash
prlt init --theme=toyotas
prlt drive prius tacoma
prlt park 4runner           # Back to the bay
prlt garage                 # Check your fleet
```

**Agents**: 1stgen4runner, 2ndgen4runner, 3rdgen4runner, alltrac, camry, fj40, fj60, fj80, fzj80, hdj80, hdj81, highlander, hilux, ironpig, landcruiser, prius, rav4, sierra, tacoma, tercel, troopy, tundra  
**Directory**: `../[project]-garage/`

### 🏢 Companies
Let the Fortune 500 take orders from you.

```bash
prlt init --theme=companies  
prlt buy adobe amazon apple
prlt sell netflix           # Trim the overperformer
prlt portfolio              # Check your holdings
```

**Agents**: adobe, amazon, apple, atlassian, cisco, google, ibm, meta, microsoft, netflix, nvidia, oracle, shopify, snowflake, tesla, zoom  
**Directory**: `../[project]-portfolio/`

---

## 📚 Command Reference

| Theme | Create | Remove | Status | Directory |
|-------|--------|--------|--------|-----------|
| **💰 Billionaires** | `hire` | `fire` | `staff` | `../project-staff/` |
| **🚗 Cars** | `drive` | `park` | `garage` | `../project-garage/` |
| **🏢 Companies** | `buy` | `sell` | `portfolio` | `../project-portfolio/` |

### Universal Commands
- `prlt init [--theme=cars]` - Initialize with theme
- `prlt init --workspace <name>` - Optional workspace layout
- `prlt init --workspace-root <path>` - Use a custom agent directory
- `prlt list [--theme=cars]` - List available agents
- `prlt themes` - Show all themes

---

## 🛠️ How It Works

1. **Initialize**: Choose your theme, creates `../project-[directory]/`
2. **Create**: `git worktree add -b "agent/[name]/work" ../project-[directory]/[name]`
3. **Track**: Saves active agents in `.proletariat/config.json`
4. **Work**: Each agent is a persistent workspace - a complete copy of your repo where you can switch between any feature branches
5. **Remove**: `git worktree remove` and clean up tracking

**That's it!** Simple and clean.

If you chose a workspace or custom location, the layout details are stored in `.proletariat/config.json` so future commands know where to work.

---

## 🎯 Parallel AI Development in Action

```bash
# Set up persistent workspaces
prlt hire bezos musk gates

# Each workspace is a long-lived environment, not just for one feature!

# Workspace 1: "bezos" handles all authentication work
cd ../your-project-staff/bezos
claude-code .  # Claude Code owns this workspace for weeks
# Monday: Implement login
# Tuesday: Add OAuth  
# Wednesday: Fix auth bugs
# Thursday: Add 2FA
# All in the same workspace, different branches as needed

# Workspace 2: "musk" handles all API development  
cd ../your-project-staff/musk
cursor .  # Cursor lives here, building feature after feature
# Week 1: User endpoints
# Week 2: Payment endpoints
# Week 3: Analytics endpoints

# Workspace 3: "gates" is your testing ground
cd ../your-project-staff/gates
# Your manual testing, experiments, debugging
# No AI needed - just your playground

# Merge completed work as it's ready
cd ../your-project
git merge bezos/feature-login
git merge musk/api-v2
# Each workspace keeps working on the next task!
```

---

## 🌟 Why This Design Pattern?

### ❌ **Traditional Single Workspace**
```bash
# One directory, constant context switching
git checkout -b feature-1
# Work on feature 1...
git stash  # Have to stash to switch
git checkout -b feature-2  
# Lost context, files changed, AI confused...
```

### ✅ **Multiple Workspaces, One Machine**  
```bash
# Set up workspaces on your local machine
prlt hire bezos musk gates

# Each workspace ready for AI or manual work
prlt staff
# 💰 BEZOS: ✅ Cursor session 1 → ../project-staff/bezos
# 💰 MUSK: ✅ Claude Code session → ../project-staff/musk  
# 💰 GATES: ✅ Your manual edits → ../project-staff/gates

# Three workspaces, three features, all on your machine!
```

**Scale your solo development: Multiple workspaces, parallel progress, zero stashing!** 🎉

---


## 🏆 Perfect For

- **Running Multiple Cursor Sessions** - Open 3+ Cursor windows, each editing a different workspace/feature
- **Parallel Claude Code Instances** - Launch multiple Claude Code sessions working on separate tasks
- **Concurrent CLI Agents** - Run Codex, Aider, or other CLI agents simultaneously in different workspaces
- **Mixed AI Tools** - Cursor in one workspace, Claude Code in another, Copilot in a third
- **Scaling Solo Development** - One developer running multiple AI sessions on their machine
- **Rapid Prototyping** - Each workspace explores different approaches without affecting others

---

## 🚀 Contributing & Releases

See [RELEASE.md](./RELEASE.md) for the release process.

## 📜 License

MIT License - Because the revolutions is open source.

---

<div align="center">

**✊ WORKERS OF THE CODEBASE, UNITE! ✊**

*The simplest, most fun git worktree manager in existence!*

[![npm version](https://img.shields.io/npm/v/@proletariat/cli.svg)](https://www.npmjs.com/package/@proletariat/cli)
[![Downloads](https://img.shields.io/npm/dm/@proletariat/cli.svg)](https://npmjs.org/package/@proletariat/cli)
[![git-worktree](https://img.shields.io/badge/git--worktree-themed-red.svg)](https://github.com/chrismcdermut/proletariat-cli)

**[⭐ Star on GitHub](https://github.com/chrismcdermut/proletariat-cli) • [📦 Install from NPM](https://www.npmjs.com/package/@proletariat/cli) • [🐛 Report Issues](https://github.com/chrismcdermut/proletariat-cli/issues)**

</div>
