# Troubleshooting

This guide covers common issues and their solutions when using Proletariat.

## Installation Issues

### Command Not Found: prlt

**Symptom**: `command not found: prlt` after installation

**Solutions**:

1. **Verify installation**:
   ```bash
   npm list -g @proletariat/cli
   ```

2. **Check npm global path**:
   ```bash
   npm config get prefix
   # Add to PATH if needed:
   export PATH="$(npm config get prefix)/bin:$PATH"
   ```

3. **Reinstall**:
   ```bash
   npm uninstall -g @proletariat/cli
   npm install -g @proletariat/cli
   ```

### Native Module Build Errors

**Symptom**: `better_sqlite3.node: not a mach-o file` or similar

**Cause**: Compiled native module incompatible with Node.js version

**Solution**:

```bash
# Check active runtime (Node version, ABI, platform, arch)
node -p "process.version + ' abi=' + process.versions.modules + ' ' + process.platform + '-' + process.arch"

# Rebuild native modules for the active runtime
npm rebuild better-sqlite3

# Validate native binding can load
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.close(); console.log('better-sqlite3 OK')"
```

If the validation still fails, reinstall with the same Node runtime used to run `prlt`:

```bash
npm uninstall -g @proletariat/cli
npm install -g @proletariat/cli
```

#### Supported Node + Native Binary Combinations

`prlt` supports Node majors: `20`, `22`, `23`, `24`, `25`.

The `better-sqlite3` binary must match all of:

1. Node major + ABI (`process.versions.modules`)
2. Platform (`darwin`, `linux`)
3. Architecture (`arm64`, `x64`)

Common valid runtime targets:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`

If your terminal architecture differs from your Node architecture (for example Rosetta shell with ARM Node), rebuild under the runtime you actually use to run `prlt`.

### Bun Install Fails on better-sqlite3

**Symptom**: `bun install -g @proletariat/cli` fails with errors like:
- `TypeError: (0, isexe_1.default) is not a function`
- `node-gyp` build failures referencing `which.js`
- `better-sqlite3` compilation errors during install

**Cause**: Bun's node-gyp compatibility is limited. The `which` package (a node-gyp dependency) relies on `isexe`, which behaves differently under Bun's runtime shims. This prevents better-sqlite3 from compiling its native C++ addon.

**Solution**: Use a different package manager:

```bash
# Recommended: Homebrew (macOS) — no compilation needed
brew install chrismcdermut/proletariat/prlt

# Alternative: npm (all platforms)
npm install -g @proletariat/cli

# Alternative: pnpm
pnpm install -g @proletariat/cli
```

If you want to use Bun for other tools but need `prlt`:

```bash
# Install prlt with npm, then use bun for everything else
npm install -g @proletariat/cli
```

**Background**: `prlt` uses `better-sqlite3` for its local database, which requires a native C++ addon compiled for your specific Node.js version and platform. Bun's node-gyp support is experimental and cannot reliably compile this addon. The `postinstall` validation will warn (not error) under Bun to allow the install to complete, but `prlt` will not work until the native module is properly built with Node.js.

### Install-Time Native Validation

`apps/cli` now validates `better-sqlite3` during `postinstall`:

```bash
npm rebuild better-sqlite3 && node ./bin/validate-better-sqlite3.cjs
```

Under **Bun**, the validation script will warn instead of failing, since Bun's node-gyp issues are expected. The install will complete but `prlt` may not function until the native module is rebuilt with Node.js.

### Install Path Conflicts (EEXIST / Multiple Versions)

**Symptom**: `EEXIST: file already exists` when running `npm install -g`, or `brew upgrade` reports "already installed" on an old version, or `which prlt` points to the wrong binary.

**Cause**: Multiple installation methods (Homebrew, npm, standalone) have placed binaries in different PATH locations. Your shell runs whichever one appears first in `PATH`.

**Diagnosis**:

```bash
# See which binary is active
which prlt

# Check for multiple installations
which -a prlt

# Check install method detection
prlt self-update --check
```

**Solution**: Uninstall all but one installation method, then reinstall the one you want.

```bash
# Remove Homebrew version
brew uninstall prlt

# Remove npm global version
npm uninstall -g @proletariat/cli

# Remove standalone version
rm -rf ~/.local/lib/proletariat ~/.local/bin/prlt
```

Then install fresh using your preferred method. See the full [Switching Install Methods](./switching-install-methods.md) guide.

### Permission Denied During Install (EACCES)

**Symptom**: `EACCES: permission denied, mkdir '/opt/homebrew/lib/node_modules/@proletariat'` or similar `EACCES` errors on `/usr/local/lib/node_modules`.

**Cause**: npm's global install directory is owned by root or another user. This commonly happens on macOS when Node.js was installed via Homebrew (which puts global modules under `/opt/homebrew/`).

**Solutions**:

1. **Use Homebrew instead** (macOS, recommended — avoids the problem entirely):
   ```bash
   brew install chrismcdermut/proletariat/prlt
   ```

2. **Set a user-writable npm prefix** (all platforms):
   ```bash
   mkdir -p ~/.npm-global
   npm config set prefix '~/.npm-global'
   export PATH="$HOME/.npm-global/bin:$PATH"
   # Add the export to ~/.zshrc or ~/.bashrc for persistence:
   echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
   npm install -g @proletariat/cli
   ```

3. **Fix existing npm directory permissions** (use with caution):
   ```bash
   sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}
   ```

**Do NOT use `sudo npm install -g`** — this can cause further permission issues and is not recommended.

## Workspace Issues

### Database Not Found

**Symptom**: `Database not found at ... Run 'prlt new' first`

**Cause**: Not in a prlt workspace or PRLT_HQ_PATH incorrect

**Solutions**:

1. **Initialize workspace**:
   ```bash
   prlt new
   ```

2. **Check current directory**:
   ```bash
   pwd
   ls -la .proletariat/
   ```

3. **Set HQ path**:
   ```bash
   export PRLT_HQ_PATH=/path/to/your/hq
   ```

### Multiple Workspace Databases

**Symptom**: Different tickets/data in different directories

**Cause**: Multiple `.proletariat/` directories created

**Solution**:

1. Find all workspace databases:
   ```bash
   find ~ -name "workspace.db" 2>/dev/null
   ```

2. Set explicit HQ path:
   ```bash
   export PRLT_HQ_PATH=/path/to/correct/hq
   ```

### Corrupted Database

**Symptom**: `SqliteError` or unexpected query results

**Solutions**:

1. **Check database integrity**:
   ```bash
   sqlite3 .proletariat/workspace.db "PRAGMA integrity_check;"
   ```

2. **Backup and recreate** (last resort):
   ```bash
   mv .proletariat/workspace.db .proletariat/workspace.db.backup
   prlt new
   ```

## Docker Issues

### Docker Daemon Not Running

**Symptom**: `Cannot connect to the Docker daemon`

**Solutions**:

**macOS**:
```bash
open -a Docker
# Wait for Docker Desktop to start
```

**Linux**:
```bash
sudo systemctl start docker
sudo systemctl enable docker  # Auto-start on boot
```

### Permission Denied (Docker)

**Symptom**: `permission denied while trying to connect to Docker daemon`

**Solution** (Linux):
```bash
sudo usermod -aG docker $USER
# Log out and back in, or:
newgrp docker
```

### Container Won't Start

**Symptom**: Container exits immediately or won't start

**Debug**:

```bash
# Check Docker logs
docker logs <container-id>

# Check prlt execution logs
prlt execution list
prlt execution logs <execution-id>
```

**Common causes**:
- Missing environment variables (GITHUB_TOKEN, ANTHROPIC_API_KEY)
- Volume mount path doesn't exist
- Port already in use

### Out of Disk Space

**Symptom**: `no space left on device`

**Solution**:

```bash
# Clean unused Docker resources
docker system prune -a

# Or use prlt
prlt docker prune
prlt docker clean
```

### Volume Mount Failures

**Symptom**: Files not visible in container

**Check**:

```bash
# Verify source path exists
ls -la /path/to/repo

# Check Docker settings allow sharing this path
# Docker Desktop > Settings > Resources > File Sharing
```

## Branch Pushed but No PR

### Symptom

After `work start` or `work spawn`, the branch appears on GitHub with a "Compare & pull request" banner, but no pull request was created.

### Causes

1. **`--no-pr` was active** (explicitly or inherited from batch settings)
2. **No `--create-pr` flag and no workspace default** — PR creation defaults to off unless configured
3. **`gh` CLI not installed or not authenticated** — PR creation requires `gh auth login`

### Quick Fix

Create a PR for the ticket after the fact:

```bash
prlt pr create <ticket-id>
```

### Prevention

1. **Set a workspace default** so PRs are always created for code-modifying actions:
   ```bash
   # In your workspace database, set the default:
   # This is stored in workspace_settings as execution.create_pr_default
   prlt config set execution.create_pr_default true
   ```

2. **Use `--create-pr` explicitly** when starting work:
   ```bash
   prlt work start TKT-001 --create-pr
   prlt work spawn TKT-001 TKT-002 --create-pr
   ```

3. **Check preflight output** — `work start` and `work spawn` now display the effective PR mode and its source before execution begins. Look for:
   ```
   PR mode: no-pr (flag --no-pr)
   ⚠️  WARNING: PR creation is DISABLED. Branch will be pushed but NO pull request will be created.
   ```

### PR Mode Resolution Order

PR creation mode is resolved in this order (first match wins):

1. `--create-pr` flag → create PR
2. `--no-pr` flag → skip PR
3. Non-code-modifying action (groom, review) → skip PR
4. Workspace config `execution.create_pr_default` → use configured default
5. Interactive prompt (or auto-create in `--json --yes` mode)

## Git and Branch Issues

### Worktree Already Exists

**Symptom**: `fatal: 'agents/staff/alice/repo' already exists`

**Solution**:

```bash
# Remove stale worktree
git worktree remove agents/staff/alice/repo --force

# Or rebuild agent
prlt agent rebuild alice
```

### Branch Already Exists

**Symptom**: `fatal: A branch named 'feat/alice/TKT-001-feature' already exists`

**Solutions**:

1. **Force start** (overwrites branch):
   ```bash
   prlt work start TKT-001 --force
   ```

2. **Delete old branch**:
   ```bash
   git branch -D feat/alice/TKT-001-feature
   ```

### Detached HEAD State

**Symptom**: Agent can't commit, "HEAD detached"

**Solution**:

```bash
# In agent worktree
cd agents/staff/alice/repo
git checkout -b fix-branch
git checkout main
```

### Merge Conflicts

**Symptom**: PR has merge conflicts

**Solution**:

```bash
# Checkout agent's branch
git checkout feat/alice/TKT-001-feature

# Merge main
git merge origin/main

# Resolve conflicts
# Edit files, then:
git add .
git commit -m "Resolve merge conflicts"
git push
```

## Agent Issues

### Agent Not Found

**Symptom**: `Agent 'alice' not found`

**Solutions**:

1. **List agents**:
   ```bash
   prlt agent staff list
   prlt agent temp list
   ```

2. **Add agent**:
   ```bash
   prlt agent staff add alice
   ```

### Agent Stuck in Progress

**Symptom**: Agent shows as working but nothing happening

**Solutions**:

1. **Check execution status**:
   ```bash
   prlt execution list
   ```

2. **Stop and restart**:
   ```bash
   prlt execution stop <execution-id>
   prlt work start TKT-001 --force
   ```

3. **Kill container**:
   ```bash
   prlt docker stop alice
   ```

### Ephemeral Agent Creation Fails

**Symptom**: `EACCES: permission denied, mkdir 'agents/temp'`

**Solution**:

```bash
# Create directory manually
mkdir -p agents/temp
chmod 755 agents/temp
```

## Ticket Issues

### Ticket Not Found

**Symptom**: `Ticket TKT-001 not found`

**Solutions**:

1. **Check ticket exists**:
   ```bash
   prlt ticket list
   prlt ticket list --all  # Include all statuses
   ```

2. **Check project**:
   ```bash
   prlt ticket list --project PROJ-001
   ```

### Can't Move Ticket

**Symptom**: Status move fails

**Check valid statuses**:
```bash
prlt status list
```

### Duplicate Tickets

**Symptom**: Multiple tickets with same content

**Solution**: Use ticket search to find and manage:
```bash
prlt ticket list | grep "keyword"
prlt ticket move TKT-duplicate Canceled
```

## Network and API Issues

### GitHub Authentication Failed

**Symptom**: `gh: authentication failed`

**Solution**:

```bash
# Re-authenticate
gh auth login

# Verify status
gh auth status

# For prlt
prlt gh login
prlt gh status
```

### API Rate Limited

**Symptom**: `API rate limit exceeded`

**Solution**: Wait or authenticate to increase limits:

```bash
# Ensure authenticated
gh auth status
export GITHUB_TOKEN=$(gh auth token)
```

### Claude API Errors

**Symptom**: Agent fails with API errors

**Check**:

```bash
# Verify API key set
echo $ANTHROPIC_API_KEY

# Test API access
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-sonnet-20240229","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

## Performance Issues

### Slow CLI Response

**Causes and solutions**:

1. **Large database**:
   ```bash
   # Check database size
   ls -lh .proletariat/workspace.db

   # Archive old tickets
   prlt ticket list --status Done
   ```

2. **Many containers**:
   ```bash
   docker ps -a | wc -l
   prlt docker prune
   ```

### High Memory Usage

**Monitor**:
```bash
docker stats
```

**Solutions**:
- Limit concurrent agents
- Use `--limit` flag for batch operations
- Increase Docker memory allocation

## Getting Help

### Enable Debug Output

```bash
DEBUG=* prlt <command>
```

### Check Version

```bash
prlt --version
node --version
docker --version
```

### View Logs

```bash
# Execution logs
prlt execution logs

# Docker logs
prlt docker logs <agent>
```

### Report Issues

For bugs and feature requests:
1. Check existing issues: https://github.com/proletariat-ai/proletariat/issues
2. Create new issue with:
   - prlt version
   - Node.js version
   - OS and version
   - Steps to reproduce
   - Error messages

### Community Support

- GitHub Discussions
- Discord (if available)

## Quick Fixes Checklist

When something isn't working:

1. [ ] Is Docker running? `docker info`
2. [ ] Am I in the right directory? `pwd && ls .proletariat/`
3. [ ] Is PRLT_HQ_PATH set correctly? `echo $PRLT_HQ_PATH`
4. [ ] Is the agent/ticket valid? `prlt agent list && prlt ticket list`
5. [ ] Are there stale containers? `prlt docker clean`
6. [ ] Is the database intact? `prlt workspace list`
