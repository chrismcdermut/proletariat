# ⚒️ PROLETARIAT CLI

> **Multi-Agent Development Orchestrator**  
> *Orchestrate parallel coding agents through git worktrees - each agent works independently on features, bugs, or experiments*

🚩 **Transform your development workflow with autonomous coding agents working in parallel!** 🚩

---

## 💰 What Is This?

**PROLETARIAT CLI** orchestrates multiple coding agents working in parallel on your codebase. Each agent is an independent git worktree that can:

- 🤖 **Work autonomously** on different features, bugs, or experiments simultaneously
- 🔀 **Operate in isolation** without conflicts between agents
- 🎯 **Focus on specific tasks** while maintaining clean separation of concerns

Using memorable themes, you manage your agent workforce:
- 💰 **Billionaires** become your coding workforce (Bezos, Musk, Gates)
- 🚗 **Toyotas** drive your development forward (Prius, Tacoma, Tundra)
- 🏢 **Companies** form your development portfolio (Apple, Google, Microsoft)

Each agent operates independently via git worktrees, enabling true parallel development workflows!

---

## 🎯 Core Features

### ⚡ **Zero Configuration**
Just `prlt init` and you're ready to go. Zero configuration required.

### 🎨 **Three Fun Themes**
- **💰 Billionaires**: Hire/fire billionaire workers in `../project-staff/`
- **🚗 Cars**: Drive/park cars in your `../project-garage/` 
- **🏢 Companies**: Buy/sell companies in your `../project-portfolio/`

### 🔀 **Agent-Based Development**
Each coding agent is a clean git worktree on its own branch, working independently and in parallel with other agents.

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
prlt drive tesla prius      # Cars theme  
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

**Default Layout** - Agents as siblings to your project:
```
parent-dir/
├── your-project/          (main codebase)
├── your-project-staff/    (billionaire agents)
├── your-project-garage/   (toyota agents)
└── your-project-portfolio/ (company agents)
```

**Workspace Layout** - Group project and agents under one parent directory:
```bash
prlt init --workspace my-platform
# Creates: ../my-platform/project-name-staff/
# Optionally offers to move your repo to: ../my-platform/project-name/
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

**Agents**: altman, amodei, andreesen, arnault, bezos, blakely, bloomberg, branson, brin, buffett, cook, ellison, gates, horowitz, jobs, ma, munger, musk, nadella, oprah, page, perkins, swift, whitney, wojcicki, zuckerberg  
**Directory**: `../[project]-staff/`

### 🚗 Toyotas  
Manufacturing's finest keeping your fleet humming.

```bash
prlt init --theme=toyotas
prlt drive prius tacoma
prlt park 4runner           # Back to the bay
prlt garage                 # Check your fleet
```

**Agents**: 4runner, camry, fj40, highlander, hilux, ironpig, landcruiser, prius, sierra, tacoma, tercel, troopy, tundra  
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

## 🎯 Multi-Agent Workflow

```bash
# Deploy multiple agents to work on different tasks
prlt hire bezos musk gates

# Agent 1: Bezos tackles the checkout feature
cd ../your-project-staff/bezos
git checkout -b feat/checkout-flow
# ... autonomous development

# Agent 2: Musk implements AI search
cd ../your-project-staff/musk
git checkout -b feat/ai-search
# ... parallel development

# Agent 3: Gates fixes security issues
cd ../your-project-staff/gates
git checkout -b fix/security-patches
# ... independent work

# Orchestrate: Merge all agent work
cd ../your-project
git merge feat/checkout-flow    # Integrate Bezos's work
git merge feat/ai-search        # Integrate Musk's work
git merge fix/security-patches  # Integrate Gates's work
```

---

## 🌟 Why Multi-Agent Development?

### ❌ **Traditional Single-Thread Development**
```bash
# Work on one thing at a time
git checkout -b feature-1
# ... work ...
git checkout main
git checkout -b feature-2
# Context switching, stashing, conflicts...
```

### ✅ **Multi-Agent Parallel Development**  
```bash
# Deploy agents to work simultaneously
prlt hire bezos musk gates

# Three agents, three features, zero conflicts
prlt staff
# 💰 BEZOS: ✅ Working on checkout-flow
# 💰 MUSK: ✅ Building AI search
# 💰 GATES: ✅ Fixing security issues
```

**True parallel development with memorable agent management!** 🎉

---


## 🏆 Perfect For

- **Parallel Feature Development** - Multiple agents work on different features simultaneously
- **AI-Assisted Coding** - Each agent can be powered by different AI tools or prompts
- **Distributed Bug Fixing** - Deploy agents to tackle multiple bugs in parallel
- **Experimentation** - Agents explore different solutions independently
- **Code Reviews** - Each agent's work is isolated and easy to review
- **Team Collaboration** - Assign real team members to specific agents

---

## 📜 License

MIT License - Because even revolutionaries believe in open source!

---

<div align="center">

**🚩 WORKERS OF THE CODEBASE, UNITE! ✊**

*The simplest, most fun git worktree manager in existence!*

[![npm version](https://badge.fury.io/js/@proletariat/cli.svg)](https://badge.fury.io/js/@proletariat/cli)
[![Downloads](https://img.shields.io/npm/dm/@proletariat/cli.svg)](https://npmjs.org/package/@proletariat/cli)
[![Revolutionary](https://img.shields.io/badge/git--worktree-themed-red.svg)](https://github.com/proletariat-dev/proletariat)

**[⭐ Star on GitHub](https://github.com/proletariat-dev/proletariat) • [📦 Install from NPM](https://www.npmjs.com/package/@proletariat/cli) • [🐛 Report Issues](https://github.com/proletariat-dev/proletariat/issues)**

</div>
