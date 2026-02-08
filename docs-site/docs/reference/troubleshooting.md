---
sidebar_position: 2
title: Troubleshooting
---

# Troubleshooting

Solutions to common issues.

## Installation Issues

### "command not found: prlt"

**Cause**: prlt not in PATH after installation.

**Solution**:

```bash
# Check installation location
npm list -g @proletariat/cli

# Add to PATH if needed
export PATH="$PATH:$(npm config get prefix)/bin"
```

### "npm ERR! EACCES"

**Cause**: Permission issues with global npm.

**Solution**:

```bash
# Option 1: Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH

# Option 2: Use nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install node
npm install -g @proletariat/cli
```

## Workspace Issues

### "No workspace found"

**Cause**: Not in a prlt-initialized directory.

**Solution**:

```bash
# Initialize workspace
prlt init

# Or navigate to existing workspace
cd /path/to/workspace
```

### "Database locked"

**Cause**: Multiple processes accessing database.

**Solution**:

```bash
# Check for stuck processes
ps aux | grep prlt

# Kill stuck processes
pkill -f "prlt"

# Retry command
prlt ticket list
```

## Git Issues

### "Worktree already exists"

**Cause**: Previous agent not cleaned up.

**Solution**:

```bash
# List worktrees
git worktree list

# Remove stale worktree
git worktree remove agents/temp/agent-name --force

# Cleanup agents
prlt agent cleanup
```

### "Branch already exists"

**Cause**: Branch from previous work not deleted.

**Solution**:

```bash
# Delete local branch
git branch -D feat/TKT-001-description

# Delete remote branch
git push origin --delete feat/TKT-001-description
```

### "Merge conflict in worktree"

**Cause**: Upstream changes conflict with agent work.

**Solution**:

```bash
# In agent worktree
cd agents/temp/agent-name/repo

# Merge main
git fetch origin
git merge origin/main

# Resolve conflicts
# Then continue work
```

## Docker Issues

### "Cannot connect to Docker daemon"

**Cause**: Docker not running.

**Solution**:

```bash
# Start Docker Desktop
# Or on Linux:
sudo systemctl start docker
```

### "Container build failed"

**Cause**: Invalid devcontainer.json or missing image.

**Solution**:

```bash
# Validate JSON
cat .devcontainer/devcontainer.json | jq

# Pull image manually
docker pull mcr.microsoft.com/devcontainers/base:ubuntu

# Rebuild
prlt agent rebuild <name>
```

### "Out of disk space"

**Cause**: Too many containers/images.

**Solution**:

```bash
# Clean prlt resources
prlt docker clean
prlt docker prune

# Docker system cleanup
docker system prune -a
```

## Agent Issues

### "Agent not responding"

**Cause**: Agent process crashed.

**Solution**:

```bash
# Check execution status
prlt execution list

# View logs
prlt execution logs <id>

# Stop and restart
prlt execution stop <id>
prlt work start <ticket>
```

### "Cannot attach to session"

**Cause**: Tmux session died.

**Solution**:

```bash
# List sessions
tmux list-sessions

# If session missing, restart agent
prlt execution stop <id>
prlt work start <ticket>
```

### "Agent stuck in loop"

**Cause**: Agent hitting permission prompt repeatedly.

**Solution**:

```bash
# Attach to session
prlt session attach <agent>

# Manually respond to prompts
# Or use YOLO mode next time (with Docker)
prlt work start <ticket> --skip-permissions
```

## GitHub Issues

### "gh: not authenticated"

**Cause**: GitHub CLI not logged in.

**Solution**:

```bash
gh auth login
gh auth status
```

### "GITHUB_TOKEN invalid"

**Cause**: Token expired or wrong scope.

**Solution**:

```bash
# Check token
echo $GITHUB_TOKEN

# Re-authenticate
gh auth login
# Or create new token with correct scopes:
# - repo
# - workflow (if needed)
```

### "PR creation failed"

**Cause**: Branch not pushed or permissions issue.

**Solution**:

```bash
# Push branch first
git push -u origin feat/TKT-001

# Check permissions
gh auth status

# Create PR manually if needed
gh pr create --title "Title" --body "Body"
```

## Claude Code Issues

### "Claude not authenticated"

**Cause**: Claude login expired.

**Solution**:

```bash
claude login
```

### "Claude rate limited"

**Cause**: API usage limits.

**Solution**:

- Wait for rate limit reset
- Reduce concurrent agents
- Check Anthropic account status

## Performance Issues

### "Too many open files"

**Cause**: System file descriptor limit.

**Solution**:

```bash
# Increase limit temporarily
ulimit -n 4096

# Permanently (add to /etc/security/limits.conf)
* soft nofile 4096
* hard nofile 8192
```

### "System slow with many agents"

**Cause**: Resource exhaustion.

**Solution**:

```bash
# Reduce concurrent agents
prlt execution stop --some

# Use background mode
prlt work spawn --display background

# Cleanup resources
prlt agent cleanup
prlt docker prune
```

## Getting Help

If issues persist:

1. Check debug logs: `PRLT_DEBUG=true prlt <command>`
2. Join Discord: [discord.gg/tmZyjNNSvw](https://discord.gg/tmZyjNNSvw)
3. File issue: [GitHub Issues](https://github.com/chrismcdermut/proletariat/issues)
4. Book a call: [cal.com/chrismcdermut](https://cal.com/chrismcdermut)

## Next Steps

- [Environment Variables](/reference/environment-variables) - Configuration
- [Docker Setup](/guides/docker-setup) - Container troubleshooting
- [Command Reference](/commands) - Full command help
