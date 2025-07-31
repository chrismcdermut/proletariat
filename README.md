# ⚒️ PROLETARIAT

> **Simple Themed Git Worktree Manager**  
> *Making git worktrees fun with billionaires, cars, and companies!*

🚩 **The simplest, most fun way to manage git worktrees with themed agents!** 🚩

---

## 💰 What Is This?

**PROLETARIAT** is a lightweight, themed git worktree manager that makes parallel development actually enjoyable. Instead of boring worktree commands, you get to:

- 💰 **Hire billionaires** like Bezos and Musk as your coding workforce  
- 🚗 **Drive cars** like Tesla and Prius in your development garage
- 🏢 **Buy companies** like Apple and Microsoft for your portfolio

Each "agent" is just a git worktree with a fun theme. No complex port management, no environment hassles - just simple, themed git worktree management!

---

## 🎯 Core Features

### ⚡ **Zero Configuration**
Just `proletariat init` and you're ready to go. No ports, no environments, no complexity.

### 🎨 **Three Fun Themes**
- **💰 Billionaires**: Hire/fire billionaire workers in `../project-staff/`
- **🚗 Cars**: Drive/park cars in your `../project-garage/` 
- **🏢 Companies**: Buy/sell companies in your `../project-portfolio/`

### 🔀 **Pure Git Worktrees**
Each agent is a clean git worktree on branch `[name]-workspace`. That's it!

### 📺 **Tmux Integration**
Start organized tmux sessions per agent with 4 windows: editor, terminal, git, and AI.

### 🌐 **Caddy Proxy Domains**
Generate beautiful domain names per agent instead of remembering port numbers.

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

# Start tmux sessions per agent (requires tmux)
prlt work bezos musk        # Billionaires theme
prlt ride tesla prius       # Cars theme
prlt manage apple microsoft # Companies theme

# Setup beautiful domain names (requires caddy)
prlt serve bezos musk       # Billionaires theme
prlt cruise tesla prius     # Cars theme  
prlt host apple microsoft   # Companies theme

# Check status
prlt staff                   # Billionaires theme
prlt garage                  # Cars theme
prlt portfolio               # Companies theme

# Remove worktrees  
prlt fire gates             # Billionaires theme
prlt park honda             # Cars theme
prlt sell nvidia            # Companies theme
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

**Agents**: bezos, musk, gates, buffett, zuckerberg, cook, ellison, page  
**Directory**: `../[project]-staff/`

### 🚗 Cars  
Your development garage with classic rides!

```bash
prlt init --theme=cars
prlt drive tesla prius mustang
prlt park civic             # Back to the garage
prlt garage                 # Check your fleet
```

**Agents**: tesla, prius, mustang, camry, accord, civic, hdj81, landcruiser  
**Directory**: `../[project]-garage/`

### 🏢 Companies
Build your corporate empire!

```bash
prlt init --theme=companies  
prlt buy apple microsoft google
prlt sell meta              # Dump the stock
prlt portfolio              # Check your holdings
```

**Agents**: apple, microsoft, google, amazon, meta, tesla, nvidia, oracle  
**Directory**: `../[project]-portfolio/`

---

## 📚 Command Reference

| Theme | Create | Session | Proxy | Remove | Status | Directory |
|-------|--------|---------|-------|--------|--------|-----------|
| **💰 Billionaires** | `hire` | `work` | `serve` | `fire` | `staff` | `../project-staff/` |
| **🚗 Cars** | `drive` | `ride` | `cruise` | `park` | `garage` | `../project-garage/` |
| **🏢 Companies** | `buy` | `manage` | `host` | `sell` | `portfolio` | `../project-portfolio/` |

### Universal Commands
- `prlt init [--theme=cars]` - Initialize with theme
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

### 🤖 **AI-Ready Development**
The AI window is perfect for:
- **Claude Code** sessions (`claude code`)
- **GitHub Copilot Chat** interactions  
- **ChatGPT** conversations in terminal
- **Code reviews** with AI assistants
- **Documentation** generation

### 📺 **Tmux Workflow (Optional)**
```bash
# Install tmux first
brew install tmux  # macOS
apt install tmux   # Linux

# Create agents
prlt hire bezos musk

# Start tmux sessions (creates 4 windows per agent)
prlt work bezos musk

# Attach to Bezos's session
tmux attach -t test-project-bezos

# Each session has:
# - Window 0: "editor" (for your code editor)
# - Window 1: "terminal" (for commands)  
# - Window 2: "git" (shows git status)
# - Window 3: "ai" (for Claude Code, GitHub Copilot, etc.)

# Switch between sessions
tmux attach -t test-project-musk

# Detach: Ctrl+B then D
# Kill session: tmux kill-session -t test-project-bezos
```

### 🌐 **Caddy Proxy Setup (Optional)**
```bash
# Install Caddy first
brew install caddy  # macOS
# or visit https://caddyserver.com/docs/install

# Create agents
prlt hire bezos musk

# Generate beautiful domain names
prlt serve bezos musk

# Output shows:
# 💰 BEZOS: https://bezos.your-project.test
# 💰 MUSK: https://musk.your-project.test

# Start Caddy proxy server
cd ../your-project-staff
caddy run

# Now visit beautiful URLs instead of localhost:3000!
# https://bezos.your-project.test
# https://api.bezos.your-project.test
```

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