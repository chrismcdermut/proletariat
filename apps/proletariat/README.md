# ⚒️ PROLETARIAT

> **Simple Themed Git Worktree Manager**  
> *Making git worktrees fun with billionaires, cars, and companies!*

🚩 **The simplest, most fun way to manage git worktrees with themed agents!** 🚩

---

## 🧱 Monorepo Layout

- `apps/proletariat` – CLI package published to npm
- `apps/directive` – Planned orchestration/PMO suite (coming soon)
- `packages/` – Shared libraries and utilities (future home)

## 💰 What Is This?

**PROLETARIAT** is a lightweight, themed git worktree manager that makes parallel development actually enjoyable. Instead of boring worktree commands, you get to:

- 💰 **Hire billionaires** like Bezos and Musk as your coding workforce  
- 🚗 **Drive cars** like Tesla and Prius in your development garage
- 🏢 **Buy companies** like Apple and Microsoft for your portfolio

Each "agent" is just a git worktree with a fun theme. No complex port management, no environment hassles - just simple, themed git worktree management!

---

## 🎯 Core Features

### ⚡ **Zero Configuration**
Just `prlt init` and you're ready to go. No ports, no environments, no complexity.

### 🎨 **Three Fun Themes**
- **💰 Billionaires**: Hire/fire billionaire workers in `../project-staff/`
- **🚗 Cars**: Drive/park cars in your `../project-garage/` 
- **🏢 Companies**: Buy/sell companies in your `../project-portfolio/`

### 🔀 **Pure Git Worktrees**
Each agent is a clean git worktree on branch `[name]-workspace`. That's it!

---

## 🚀 Quick Start

```bash
# Install
npm install -g proletariat

# Initialize (choose your theme)
cd your-project
prlt init

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

### 🏗️ Optional Umbrella Layout
- `prlt init --umbrella acme-platform` (or another company/product name) creates agents at `../acme-platform/<project>-staff/`, then offers to move the current repo under that workspace so source + agents live together. Say no if you want to handle it later.
- `prlt init --workspace-root ../shared/staff` lets you point directly to any directory you control.

Stay with the default if you prefer the classic sibling layout—your existing paths keep working.

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

**Agents**: andreesen, altman, amodei, bezos, blakely, bloomberg, branson, brin, buffett, cook, ellison, gates, horowitz, jobs, ma, munger, musk, nadella, oprah, page, perkins, swift, whitney, wojcicki, zuckerberg  
**Directory**: `../[project]-staff/`

### 🚗 Cars  
Manufacturing's finest keeping your fleet humming.

```bash
prlt init --theme=cars
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
- `prlt init --umbrella <name>` - Optional umbrella layout
- `prlt init --workspace-root <path>` - Use a custom agent directory
- `prlt list [--theme=cars]` - List available agents
- `prlt themes` - Show all themes

---

## 🛠️ How It Works

1. **Initialize**: Choose your theme, creates `../project-[directory]/`
2. **Create**: `git worktree add -b "agent/[name]/work" ../project-[directory]/[name]`
3. **Track**: Saves active agents in `.proletariat/config.json`
4. **Work**: Each agent is a complete copy of your repo on its own branch
5. **Remove**: `git worktree remove` and clean up tracking

**That's it!** No ports, no environments, no complexity.

If you chose an umbrella or custom workspace, the layout details are stored in `.proletariat/config.json` so future commands know where to work.

---

## 🎯 Real-World Workflow

```bash
# Bezos works on the checkout feature
cd ../your-project-staff/bezos
git checkout -b feat/checkout-flow
# ... make changes, commit, push

# Meanwhile, Musk tackles search  
cd ../your-project-staff/musk
git checkout -b feat/ai-search
# ... work simultaneously with no conflicts

# Back to main project
cd ../your-project
git checkout main
git merge feat/checkout-flow    # Merge Bezos's work
git merge feat/ai-search        # Merge Musk's work
```

---

## 🌟 Why Proletariat?

### ❌ **Before Proletariat**
```bash
git worktree add ../feature-branch-1 -b feature-1
git worktree add ../feature-branch-2 -b feature-2
git worktree list  # boring output
```

### ✅ **After Proletariat**  
```bash
prlt hire bezos musk
prlt staff
# 💰 BEZOS: ✅ ACTIVE - Ready to work for YOU!
# 💰 MUSK: ✅ ACTIVE - Building rockets and cars!
```

**Same functionality, 100% more fun!** 🎉

---

## 🔍 What's Different in v2.0?

**Simplified Focus**: Removed all the complex port management and environment generation. Now it's purely about making git worktrees fun and easy with themes.

**What's Gone**:
- ❌ Port management
- ❌ Environment file generation  
- ❌ Service coordination
- ❌ Complex configurations

**What Stayed**:
- ✅ Themed agent names
- ✅ Git worktree management
- ✅ Fun, revolutionary branding
- ✅ Simple, clean interface

---

## 🤝 Contributing

1. Fork the repo
2. `prlt hire your-username` (make a worktree!)
3. Make your changes
4. Submit a PR

---

## 🏆 Perfect For

- **Feature development** - Each feature gets its own themed agent
- **Bug fixes** - Quick worktree creation with fun names
- **Code reviews** - Switch between branches instantly
- **Experimentation** - Try ideas without affecting main work
- **Team fun** - Make git worktrees actually enjoyable!

---

## 📜 License

MIT License - Because even revolutionaries believe in open source!

---

<div align="center">

**🚩 WORKERS OF THE CODEBASE, UNITE! ✊**

*The simplest, most fun git worktree manager in existence!*

[![npm version](https://badge.fury.io/js/proletariat.svg)](https://badge.fury.io/js/proletariat)
[![Downloads](https://img.shields.io/npm/dm/proletariat.svg)](https://npmjs.org/package/proletariat)
[![Revolutionary](https://img.shields.io/badge/git--worktree-themed-red.svg)](https://github.com/proletariat-dev/proletariat)

**[⭐ Star on GitHub](https://github.com/proletariat-dev/proletariat) • [📦 Install from NPM](https://www.npmjs.com/package/proletariat) • [🐛 Report Issues](https://github.com/proletariat-dev/proletariat/issues)**

</div>
