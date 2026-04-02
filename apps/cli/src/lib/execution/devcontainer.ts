/**
 * Devcontainer Template Generator
 *
 * Generates .devcontainer/ configuration for agent isolated execution.
 * Uses a custom Dockerfile with network firewall for security isolation.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { ExecutionConfig, DEFAULT_EXECUTION_CONFIG, ExecutorType } from './types.js'
import { parseChannel } from '../workspace-config.js'
// CC_DEFAULT_VERSION removed in PRLT-1240 — no longer pinning Claude Code version.
// The claude-launcher.sh wrapper handles onboarding settings persistence.

export type MountMode = 'worktree' | 'clone'

export interface DevcontainerOptions {
  agentName: string
  ticketId?: string
  agentDir: string
  repoWorktrees?: string[]  // Names of repo worktrees to mount (only needed for worktree mode)
  memory?: string
  cpus?: number
  timezone?: string
  /** prlt channel: "npm", "npm:dev", "gh", "gh:dev", "mount", or version like "npm:1.2.3" */
  prltChannel?: string
  /** Mount mode: 'worktree' needs parent repo mounts + git wrapper, 'clone' is self-contained */
  mountMode?: MountMode
  /** Git user.name for commit attribution (detected from gh/git config on host) */
  gitUserName?: string
  /** Git user.email for commit attribution (detected from gh/git config on host) */
  gitUserEmail?: string
  /** Executor type - determines which CLI tools to install and which API domains to whitelist */
  executor?: ExecutorType
  /** Extra domains to allow in the container firewall (merged with config.firewall.allowlistDomains) */
  networkAllowlist?: string[]
  /** Pinned @anthropic-ai/claude-code version (e.g., "2.1.80"). Omit for latest. */
  claudeCodeVersion?: string
}

export interface DevcontainerJson {
  name: string
  build: {
    dockerfile: string
    args?: Record<string, string>
  }
  customizations: {
    vscode: {
      extensions: string[]
      settings?: Record<string, unknown>
    }
  }
  capAdd: string[]
  runArgs: string[]
  remoteUser: string
  mounts: string[]
  containerEnv?: Record<string, string>
  workspaceFolder: string
  postStartCommand: string
  waitFor: string
}

/**
 * Generate default devcontainer.json content
 *
 * Uses a custom Dockerfile with firewall for network isolation.
 * Mounts the entire agent workspace directory so all contents (repos, prompt files, etc.)
 * are accessible inside the container at /workspace.
 */
export function generateDevcontainerJson(options: DevcontainerOptions, config?: ExecutionConfig): DevcontainerJson {
  const cfg = config || DEFAULT_EXECUTION_CONFIG
  const mountMode = options.mountMode || 'worktree'  // Default to worktree mode

  // Parse the channel to determine registry and version
  const channel = parseChannel(options.prltChannel || 'npm')
  const useMount = channel.registry === 'mount'

  // Build args for Dockerfile
  const buildArgs: Record<string, string> = {
    TZ: options.timezone || 'America/Los_Angeles',
  }

  // Pass registry and version to Dockerfile
  // For mount mode, we pass PRLT_REGISTRY=mount so Dockerfile skips npm install
  buildArgs.PRLT_REGISTRY = channel.registry
  if (!useMount) {
    buildArgs.PRLT_VERSION = channel.version || 'latest'
  }

  // PRLT-1240: Only pin Claude Code version if explicitly specified.
  // The claude-launcher.sh wrapper handles onboarding settings persistence,
  // so version pinning is no longer needed as a workaround.
  if (options.claudeCodeVersion) {
    buildArgs.CC_VERSION = options.claudeCodeVersion
  }

  // For GitHub Packages, pass GITHUB_TOKEN as build arg
  if (channel.registry === 'gh') {
    buildArgs.GITHUB_TOKEN = '${localEnv:GITHUB_TOKEN}'
  }

  // Determine if this is a Claude Code executor (for Claude-specific mounts/config)
  const isClaude = !options.executor || options.executor === 'claude-code'

  // Build mounts array - parent repo mounts only needed for worktree mode
  // TKT-801: Use consistency=cached to reduce grpcfuse contention on Docker Desktop.
  // This helps prevent kernel panics when multiple containers mount the same paths concurrently.
  const mounts: string[] = [
    'source=${localWorkspaceFolder},target=/workspace,type=bind,consistency=cached',
    'source=claude-bash-history,target=/commandhistory,type=volume',
    // Claude credentials volume - only needed for Claude Code executor
    ...(isClaude ? ['source=claude-credentials,target=/home/node/.claude,type=volume'] : []),
    // NOTE: ~/.claude.json is COPIED (not mounted) to /workspace/.claude.json
    // to avoid corruption from concurrent writes by multiple containers
    // NOTE: SSH agent socket mounting doesn't work reliably on Docker Desktop for Mac
    // So we use HTTPS + token approach instead. The token is fetched fresh at spawn time.
    'source=${localEnv:PRLT_HQ_PATH}/.proletariat,target=/hq/.proletariat,type=bind,readonly,consistency=cached',
    // PMO path can be anywhere (e.g., /hq/pmo or /hq/repos/myrepo/pmo)
    // Use PRLT_PMO_PATH env var to mount the actual location to /hq/pmo
    'source=${localEnv:PRLT_PMO_PATH},target=/hq/pmo,type=bind,consistency=cached',
  ]

  // Only add parent repo mounts for worktree mode
  // Worktree .git files reference paths like /Users/.../repos/{repoName}/.git/worktrees/name
  // These mounts make those paths accessible inside the container at /hq/repos/{repoName}
  // Clone mode doesn't need this because each clone has its own self-contained .git directory
  // NOTE: Cannot use readonly because git worktrees share the object store with parent repo.
  // Commits write to parent's .git/objects/ and refs update in .git/worktrees/<name>/
  if (mountMode === 'worktree' && options.repoWorktrees) {
    for (const repoName of options.repoWorktrees) {
      mounts.push(`source=\${localEnv:PRLT_HQ_PATH}/repos/${repoName},target=/hq/repos/${repoName},type=bind,consistency=cached`)
    }
  }

  // If using "mount" channel, mount local prlt build from PRLT_REPO_PATH
  // The setup-prlt.sh script will detect /opt/prlt and configure the wrapper
  // TKT-801: Use readonly,consistency=cached to reduce grpcfuse contention
  if (useMount) {
    mounts.push('source=${localEnv:PRLT_REPO_PATH},target=/opt/prlt,type=bind,readonly,consistency=cached')
  }

  // PRLT-1130: Mount pnpm store cache read-only for fast installs.
  // If the volume doesn't exist yet, Docker creates an empty one (setup script handles gracefully).
  mounts.push('source=pnpm-store-cache,target=/tmp/pnpm-store-cache,type=volume,readonly')

  const devcontainerJson: DevcontainerJson = {
    name: `Agent: ${options.agentName}`,
    build: {
      dockerfile: 'Dockerfile',
      args: buildArgs,
    },
    customizations: {
      vscode: {
        extensions: [
          'anthropic.claude-code',
          'dbaeumer.vscode-eslint',
          'esbenp.prettier-vscode',
        ],
        settings: {
          'editor.formatOnSave': true,
          'editor.defaultFormatter': 'esbenp.prettier-vscode',
        },
      },
    },
    capAdd: ['NET_ADMIN', 'NET_RAW'],
    runArgs: [
      `--memory=${options.memory || cfg.devcontainer.memory}`,
      `--cpus=${options.cpus || cfg.devcontainer.cpus}`,
    ],
    remoteUser: 'node',
    mounts,
    containerEnv: {
      DEVCONTAINER: 'true',
      // NOTE: ANTHROPIC_API_KEY is intentionally NOT passed by default.
      // Claude Code prefers API key over OAuth, so passing it would cause agents
      // to burn API credits instead of using Max subscription via OAuth.
      // GH_TOKEN enables gh CLI in container (for PR creation, etc.)
      GH_TOKEN: '${localEnv:GH_TOKEN}',
      GITHUB_TOKEN: '${localEnv:GITHUB_TOKEN}',
      PRLT_HQ_PATH: '/hq',
      // Agent identity - allows agent to know its name and host path
      PRLT_AGENT_NAME: options.agentName,
      PRLT_TICKET_ID: options.ticketId || '',
      PRLT_HOST_PATH: options.agentDir,
      // Mount mode - allows scripts to know if git wrapper is needed
      PRLT_MOUNT_MODE: mountMode,
      // Git identity for commit attribution (detected from host's gh/git config)
      ...(options.gitUserName ? { PRLT_GIT_USER_NAME: options.gitUserName } : {}),
      ...(options.gitUserEmail ? { PRLT_GIT_USER_EMAIL: options.gitUserEmail } : {}),
      // prlt channel info for version updates at container startup (TKT-954)
      PRLT_REGISTRY: channel.registry,
      ...(!useMount ? { PRLT_VERSION: channel.version || 'latest' } : {}),
      // /hq/.proletariat/bin contains prlt wrapper with ESM loader for native modules
      PATH: '/hq/.proletariat/bin:/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin',
    },
    workspaceFolder: '/workspace',
    postStartCommand: 'sudo /usr/local/bin/init-firewall.sh && /usr/local/bin/setup-prlt.sh',
    waitFor: 'postStartCommand',
  }

  return devcontainerJson
}

/**
 * Generate Dockerfile content for the devcontainer.
 * Uses architecture auto-detection for cross-platform compatibility.
 */
export function generateDockerfile(options: DevcontainerOptions): string {
  const timezone = options.timezone || 'America/Los_Angeles'

  return `FROM node:22

# Ensure we run as root for apt-get and system setup
USER root

ARG TZ=${timezone}
ENV TZ=\${TZ}
ENV DEVCONTAINER=true

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    less git git-lfs procps sudo fzf zsh man-db unzip gnupg2 gh tmux \\
    iptables ipset iproute2 dnsutils jq nano vim \\
    && rm -rf /var/lib/apt/lists/* \\
    && git lfs install

# Create workspace and claude directories
RUN mkdir -p /workspace /home/node/.claude \\
    && chown -R node:node /workspace /home/node/.claude

# Set up persistent bash history
RUN mkdir -p /commandhistory \\
    && touch /commandhistory/.bash_history \\
    && chown -R node:node /commandhistory

# Install git-delta for better diffs (architecture-aware)
RUN ARCH=$(dpkg --print-architecture) && \\
    curl -L "https://github.com/dandavison/delta/releases/download/0.18.2/git-delta_0.18.2_\${ARCH}.deb" -o /tmp/delta.deb && \\
    dpkg -i /tmp/delta.deb && \\
    rm /tmp/delta.deb

# Install zsh with oh-my-zsh
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended \\
    && chsh -s /bin/zsh node

# Configure npm global directory
RUN mkdir -p /home/node/.npm-global/bin /home/node/.npm-global/lib \\
    && chown -R node:node /home/node/.npm-global
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.npm-global/bin:\$PATH

# Install pnpm and executor CLI as node user so files are owned correctly
# CC_VERSION: pinned @anthropic-ai/claude-code version (e.g., "2.1.80") or empty for latest
ARG CC_VERSION=
USER node
RUN npm install -g pnpm && npm install -g @anthropic-ai/claude-code\${CC_VERSION:+@\${CC_VERSION}}${options.executor === 'codex' ? ' && npm install -g @openai/codex' : ''}
USER root

# Install prlt CLI from public npm
# PRLT_REGISTRY: "npm" (install from npmjs.com) or "mount" (use host mount)
# PRLT_VERSION: version/tag like "latest", "dev", "next", or "1.2.3"
ARG PRLT_REGISTRY=npm
ARG PRLT_VERSION=latest
RUN if [ "\${PRLT_REGISTRY}" = "npm" ] || [ "\${PRLT_REGISTRY}" = "gh" ]; then \\
      echo "Installing @proletariat/cli@\${PRLT_VERSION} from npm..." && \\
      npm install -g @proletariat/cli@\${PRLT_VERSION}; \\
    else \\
      echo "prlt will be mounted from host (mount mode)"; \\
    fi

# Copy and set up scripts
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
COPY setup-prlt.sh /usr/local/bin/setup-prlt.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/setup-prlt.sh /usr/local/bin/entrypoint.sh

# Allow node user to run firewall script without password
RUN echo "node ALL=(ALL) NOPASSWD: /usr/local/bin/init-firewall.sh" >> /etc/sudoers

# Set default editor
ENV EDITOR=nano

# Configure shell history
ENV HISTFILE=/commandhistory/.bash_history

USER node
WORKDIR /workspace
`
}

/**
 * Generate firewall initialization script.
 * Whitelists only necessary domains for the configured executor.
 * Claude Code requires api.anthropic.com; Codex requires api.openai.com.
 */
export function generateFirewallScript(executor?: ExecutorType, extraAllowedDomains: string[] = []): string {
  const extraDomainCommands = [...new Set(extraAllowedDomains
    .map(domain => domain.trim().toLowerCase())
    .filter(domain => /^[a-z0-9.-]+$/.test(domain)))]
    .map(domain => `add_domain "${domain}"`)
    .join('\n')

  return `#!/bin/bash
set -e

echo "Initializing firewall..."

# Preserve Docker's DNS rules before flushing
DOCKER_DNS_RULES=$(iptables-save | grep -E "DOCKER|docker" || true)

# Flush existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X

# Restore Docker DNS rules
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "$DOCKER_DNS_RULES" | iptables-restore -n
fi

# Create ipset for allowed domains (use hash:net to support CIDR ranges)
ipset create allowed-domains hash:net -exist

# Allow localhost
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Get host network and allow it (needed for Docker networking)
HOST_NETWORK=$(ip route | grep default | awk '{print $3}' | head -1)
if [ -n "$HOST_NETWORK" ]; then
    HOST_SUBNET=$(echo $HOST_NETWORK | sed 's/\\.[0-9]*$/.0\\/24/')
    iptables -A OUTPUT -d $HOST_SUBNET -j ACCEPT
fi

# Function to resolve and add domain IPs
add_domain() {
    local domain=$1
    echo "Adding $domain..."
    for ip in $(dig +short $domain A 2>/dev/null || true); do
        if [[ $ip =~ ^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then
            ipset add allowed-domains $ip -exist
        fi
    done
}

# Add hardcoded GitHub IP ranges (from https://api.github.com/meta)
# These are stable and published by GitHub
echo "Adding GitHub IP ranges..."
# GitHub git operations
ipset add allowed-domains 192.30.252.0/22 -exist 2>/dev/null || true
ipset add allowed-domains 185.199.108.0/22 -exist 2>/dev/null || true
ipset add allowed-domains 140.82.112.0/20 -exist 2>/dev/null || true
ipset add allowed-domains 143.55.64.0/20 -exist 2>/dev/null || true
# GitHub API
ipset add allowed-domains 20.201.28.151/32 -exist 2>/dev/null || true
ipset add allowed-domains 20.205.243.166/32 -exist 2>/dev/null || true
ipset add allowed-domains 20.87.245.0/24 -exist 2>/dev/null || true
ipset add allowed-domains 20.248.137.48/32 -exist 2>/dev/null || true
ipset add allowed-domains 20.207.73.82/32 -exist 2>/dev/null || true
ipset add allowed-domains 20.27.177.113/32 -exist 2>/dev/null || true
ipset add allowed-domains 20.200.245.247/32 -exist 2>/dev/null || true
ipset add allowed-domains 20.233.54.53/32 -exist 2>/dev/null || true
ipset add allowed-domains 4.208.26.197/32 -exist 2>/dev/null || true
# GitHub web/packages
ipset add allowed-domains 20.26.156.215/32 -exist 2>/dev/null || true

# Also resolve github.com domains dynamically (in case IPs change)
add_domain "github.com"
add_domain "api.github.com"
add_domain "codeload.github.com"
add_domain "objects.githubusercontent.com"
add_domain "raw.githubusercontent.com"
add_domain "npm.pkg.github.com"

# Add executor-specific API domains
add_domain "api.anthropic.com"
add_domain "console.anthropic.com"
${executor === 'codex' ? `# Codex API domains
add_domain "api.openai.com"
add_domain "openai.com"` : ''}
add_domain "sentry.io"
add_domain "registry.npmjs.org"
add_domain "npmjs.com"
add_domain "nodejs.org"
add_domain "update.code.visualstudio.com"
add_domain "vscode.download.prss.microsoft.com"
${extraDomainCommands ? `# Additional user-configured allowlist domains
${extraDomainCommands}` : ''}

# Runtime allowlist domains (comma-separated), e.g. PRLT_EXTRA_ALLOWLIST_DOMAINS=api.staging.example.com
if [ -n "\${PRLT_EXTRA_ALLOWLIST_DOMAINS:-}" ]; then
    IFS=',' read -ra EXTRA_DOMAINS <<< "$PRLT_EXTRA_ALLOWLIST_DOMAINS"
    for domain in "\${EXTRA_DOMAINS[@]}"; do
        domain="\${domain//[[:space:]]/}"
        if [ -n "$domain" ]; then
            add_domain "$domain"
        fi
    done
fi

# Allow traffic to whitelisted IPs
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# Set default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow SSH (in case needed for debugging)
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

echo "Firewall initialized."

# Verify firewall is working
echo "Testing firewall..."
if curl -s --max-time 3 https://example.com >/dev/null 2>&1; then
    echo "WARNING: example.com is reachable (should be blocked)"
else
    echo "✓ example.com blocked as expected"
fi

if curl -s --max-time 5 https://api.anthropic.com >/dev/null 2>&1; then
    echo "✓ api.anthropic.com reachable"
else
    echo "Note: api.anthropic.com not reachable (may need auth)"
fi

if curl -s --max-time 5 https://github.com >/dev/null 2>&1; then
    echo "✓ github.com reachable"
else
    echo "WARNING: github.com not reachable"
fi

echo "Firewall setup complete."
`
}

/**
 * Generate prlt setup script.
 * Rebuilds better-sqlite3 if prlt is mounted from host (not installed via npm).
 */
export function generatePrltSetupScript(): string {
  // Note: Using single quotes in heredoc marker ('GITWRAPPER') prevents bash variable expansion
  // but TypeScript still sees ${} as template literals, so we escape them with backslash
  return `#!/bin/bash
# Setup prlt CLI - rebuild native modules if using mounted version

# Configure git wrapper to handle worktree path translation
# Worktree .git files contain host paths like: gitdir: /Users/.../repos/{repoName}/.git/worktrees/name
# Inside container, the parent repos are mounted at /hq/repos/{repoName}
#
# We create a git wrapper that translates paths on-the-fly using GIT_DIR
# This avoids modifying the .git file which is bind-mounted from the host
#
setup_git_wrapper() {
    # Create git wrapper script in user's bin directory (already in PATH before /usr/bin)
    mkdir -p /home/node/.npm-global/bin
    cat > /home/node/.npm-global/bin/git << 'GITWRAPPER'
#!/bin/bash
# Git wrapper that handles worktree path translation for containers
# Translates host paths in .git files to container paths

# Find the .git file/dir by walking up the directory tree
find_git_file() {
    local dir="$PWD"
    while [ "$dir" != "/" ]; do
        if [ -f "$dir/.git" ]; then
            echo "$dir/.git"
            return 0
        elif [ -d "$dir/.git" ]; then
            # Regular git repo, not a worktree - no translation needed
            return 1
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

# Check if we need to translate the path
GIT_FILE="$(find_git_file)"
if [ -n "$GIT_FILE" ]; then
    # Read the gitdir path from the .git file
    # Format is: gitdir: /path/to/repos/{repoName}/.git/worktrees/name
    HOST_PATH="$(sed -n 's/^gitdir: *//p' "$GIT_FILE")"

    # Check if it's a host path that needs translation
    case "$HOST_PATH" in
        /Users/*|/home/*)
            WORKTREE_NAME="$(basename "$HOST_PATH")"
            # Extract repo name from host path: .../repos/{repoName}/.git/worktrees/...
            # Remove .git/worktrees/name suffix, then get basename
            REPO_PATH="$(echo "$HOST_PATH" | sed 's|/.git/worktrees/.*||')"
            REPO_NAME="$(basename "$REPO_PATH")"
            CONTAINER_PATH="/hq/repos/$REPO_NAME/.git/worktrees/$WORKTREE_NAME"
            if [ -d "$CONTAINER_PATH" ]; then
                export GIT_DIR="$CONTAINER_PATH"
                export GIT_WORK_TREE="$(dirname "$GIT_FILE")"
            fi
            ;;
    esac
fi

# Run the real git command
exec /usr/bin/git "$@"
GITWRAPPER

    chmod +x /home/node/.npm-global/bin/git
    echo "Git wrapper installed for worktree path translation"
}

# Set up git wrapper for worktree path translation (only needed for worktree mount mode)
if [ "\${PRLT_MOUNT_MODE:-clone}" = "worktree" ]; then
    setup_git_wrapper
else
    echo "Clone mode: git wrapper not needed (self-contained .git directories)"
fi

# Copy Claude credentials from workspace to home (each container gets its own copy)
if [ -f "/workspace/.claude.json" ]; then
    cp /workspace/.claude.json /home/node/.claude.json
    echo "Claude credentials copied"
fi

# Configure git authentication using GitHub token
# Token is passed via GITHUB_TOKEN env var (set fresh at spawn time by runners.ts)
TOKEN=""
if [ -n "$GITHUB_TOKEN" ]; then
    TOKEN="$GITHUB_TOKEN"
    echo "Using GITHUB_TOKEN from environment"
elif [ -n "$GH_TOKEN" ]; then
    TOKEN="$GH_TOKEN"
    echo "Using GH_TOKEN from environment"
elif command -v gh &> /dev/null && gh auth status &>/dev/null; then
    TOKEN=$(gh auth token 2>/dev/null)
    if [ -n "$TOKEN" ]; then
        echo "Using token from gh CLI"
        export GH_TOKEN="$TOKEN"
    fi
fi

if [ -n "$TOKEN" ]; then
    # Store token in a file for the credential helper (avoids env var issues)
    echo "$TOKEN" > /home/node/.github-token
    chmod 600 /home/node/.github-token

    # Configure git credential helper to read token from file
    git config --global credential.helper "!f() { echo \\"username=x-access-token\\"; echo \\"password=\\$(cat /home/node/.github-token)\\"; }; f"

    # Convert SSH URLs to HTTPS (SCP style: git@github.com:user/repo.git)
    git config --global url."https://github.com/".insteadOf "git@github.com:"

    # Configure gh CLI to use the token
    echo "$TOKEN" | gh auth login --with-token 2>/dev/null && echo "gh CLI authenticated" || echo "gh CLI auth (optional)"

    echo "Git configured for GitHub push via HTTPS"
else
    echo "Warning: No GitHub token found, git push will require manual auth"
fi

# Configure git push to automatically set upstream tracking branch
# Without this, 'git push' fails on new branches created with 'git checkout -b'
# because no upstream is configured. This makes 'git push' equivalent to
# 'git push -u origin <current-branch>' on first push. (TKT-157 / GH#823)
git config --global push.autoSetupRemote true

# Configure git user identity for commit attribution
# Uses env vars set by host (from gh/git config), with fallback detection
configure_git_identity() {
    local git_name="\${PRLT_GIT_USER_NAME:-}"
    local git_email="\${PRLT_GIT_USER_EMAIL:-}"

    # Fallback: try gh api user if env vars are empty and gh is authenticated
    if { [ -z "$git_name" ] || [ -z "$git_email" ]; } && command -v gh &> /dev/null && gh auth status &>/dev/null; then
        if [ -z "$git_name" ]; then
            git_name=$(gh api user -q '.name // .login' 2>/dev/null || true)
        fi
        if [ -z "$git_email" ]; then
            git_email=$(gh api user -q '.email // empty' 2>/dev/null || true)
            # Try emails API if public email is not set
            if [ -z "$git_email" ]; then
                git_email=$(gh api user/emails -q '[.[] | select(.primary)] | .[0].email' 2>/dev/null || true)
            fi
        fi
    fi

    # Fallback: try git config from mounted repos
    if [ -z "$git_name" ] || [ -z "$git_email" ]; then
        for repo_dir in /workspace/*/; do
            if [ -d "$repo_dir/.git" ] || [ -f "$repo_dir/.git" ]; then
                if [ -z "$git_name" ]; then
                    git_name=$(/usr/bin/git -C "$repo_dir" config user.name 2>/dev/null || true)
                fi
                if [ -z "$git_email" ]; then
                    git_email=$(/usr/bin/git -C "$repo_dir" config user.email 2>/dev/null || true)
                fi
                if [ -n "$git_name" ] && [ -n "$git_email" ]; then
                    break
                fi
            fi
        done
    fi

    # Apply git config
    if [ -n "$git_name" ]; then
        /usr/bin/git config --global user.name "$git_name"
        echo "Git user.name set to: $git_name"
    fi
    if [ -n "$git_email" ]; then
        /usr/bin/git config --global user.email "$git_email"
        echo "Git user.email set to: $git_email"
    fi

    # Warning if identity could not be determined
    if [ -z "$git_name" ] && [ -z "$git_email" ]; then
        echo "Warning: Could not determine git identity. Commits may use default identity."
        echo "  To fix: run 'gh auth login' or set git config user.name/user.email in your repo"
    elif [ -z "$git_name" ]; then
        echo "Warning: Could not determine git user.name"
    elif [ -z "$git_email" ]; then
        echo "Warning: Could not determine git user.email"
    fi
}

configure_git_identity

# Check if prlt is already installed globally (via npm)
# TKT-954: Also check for updates - Docker layer caching may have installed an older version
# TKT-1029: Don't exit early - continue to workspace dependency installation
PRLT_CONFIGURED=false
if command -v prlt &> /dev/null; then
    PRLT_PATH=$(which prlt)
    if [[ "$PRLT_PATH" == "/home/node/.npm-global/bin/prlt" ]]; then
        DESIRED_VERSION="\${PRLT_VERSION:-latest}"
        CURRENT_VERSION=$(prlt --version 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' || echo "unknown")

        # Determine the target version to compare against
        if [ "$DESIRED_VERSION" = "latest" ] || [ "$DESIRED_VERSION" = "dev" ] || [ "$DESIRED_VERSION" = "next" ]; then
            # For tags, check npm registry for the actual version number
            TARGET_VERSION=$(npm view "@proletariat/cli@\${DESIRED_VERSION}" version 2>/dev/null || echo "unknown")
        else
            # For pinned versions (e.g., "1.2.3"), use directly
            TARGET_VERSION="$DESIRED_VERSION"
        fi

        if [ "$TARGET_VERSION" != "unknown" ] && [ "$CURRENT_VERSION" != "$TARGET_VERSION" ]; then
            echo "Updating prlt from v\${CURRENT_VERSION} to v\${TARGET_VERSION} (channel: \${DESIRED_VERSION})..."
            npm install -g "@proletariat/cli@\${DESIRED_VERSION}" 2>&1
            echo "prlt updated successfully"
        else
            echo "prlt v\${CURRENT_VERSION} is up to date"
        fi
        PRLT_CONFIGURED=true
    fi
fi

# Check if mounted prlt exists at /opt/prlt (skip if already configured via npm)
if [ "$PRLT_CONFIGURED" = "false" ] && [ -d "/opt/prlt/apps/cli" ]; then
    echo "Setting up mounted prlt..."

    PRLT_LOCAL="/home/node/.prlt-local"

    # Only rebuild if not already done
    if [ ! -f "$PRLT_LOCAL/.setup-complete" ]; then
        echo "Rebuilding native modules for container architecture..."
        mkdir -p "$PRLT_LOCAL"

        # Install only better-sqlite3 with correct architecture
        cd "$PRLT_LOCAL"
        npm init -y > /dev/null 2>&1
        npm install better-sqlite3@12.6.2 --build-from-source 2>&1 || {
            echo "Warning: better-sqlite3 rebuild failed"
        }

        touch "$PRLT_LOCAL/.setup-complete"
        echo "Native module rebuild complete"
    else
        echo "prlt native modules already set up"
    fi

    # Create ESM loader to redirect better-sqlite3 to rebuilt version
    LOADER="/home/node/.prlt-local/loader.mjs"
    cat > "$LOADER" << 'LOADER_EOF'
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "better-sqlite3") {
    return {
      shortCircuit: true,
      url: "file:///home/node/.prlt-local/node_modules/better-sqlite3/lib/index.js"
    };
  }
  return nextResolve(specifier, context);
}
LOADER_EOF

    # Create wrapper script that uses ESM loader for native module resolution
    WRAPPER="/home/node/.npm-global/bin/prlt"
    mkdir -p /home/node/.npm-global/bin
    cat > "$WRAPPER" << 'WRAPPER_EOF'
#!/bin/bash
NODE_NO_WARNINGS=1 exec node --experimental-loader /home/node/.prlt-local/loader.mjs /opt/prlt/apps/cli/bin/run.js "$@"
WRAPPER_EOF
    chmod +x "$WRAPPER"
    # Create prltdev symlink for consistency with dev environment
    ln -sf "$WRAPPER" /home/node/.npm-global/bin/prltdev
    echo "prlt wrapper ready at $WRAPPER (also available as prltdev)"
elif [ "$PRLT_CONFIGURED" = "false" ]; then
    echo "No mounted prlt found, skipping setup"
fi

# PRLT-1130: Configure pnpm store directory BEFORE installing workspace deps.
# Must happen before pnpm install so packages go to the right store location.
pnpm config set store-dir /tmp/pnpm-store 2>/dev/null || true

# PRLT-1130: Populate pnpm store from read-only cache if available.
# The cache volume is mounted at /tmp/pnpm-store-cache:ro by the Docker runner.
# We copy its contents to the writable /tmp/pnpm-store so pnpm install can
# find packages locally instead of downloading them (seconds vs minutes).
if [ -d "/tmp/pnpm-store-cache" ] && [ "$(ls -A /tmp/pnpm-store-cache 2>/dev/null)" ]; then
    echo "Loading pnpm store from cache..."
    mkdir -p /tmp/pnpm-store
    cp -a /tmp/pnpm-store-cache/. /tmp/pnpm-store/ 2>/dev/null || true
    echo "pnpm store cache loaded"
else
    echo "No pnpm store cache found, will download packages from network"
fi

# Install workspace dependencies if package.json exists
install_workspace_deps() {
    local workspace_dir="$1"
    if [ -f "$workspace_dir/package.json" ]; then
        echo "Installing dependencies in $workspace_dir..."
        cd "$workspace_dir"
        if [ -f "pnpm-lock.yaml" ]; then
            pnpm install 2>&1 || npm install 2>&1
        elif [ -f "package-lock.json" ]; then
            npm ci 2>&1 || npm install 2>&1
        else
            npm install 2>&1
        fi
    fi
}

# Check workspace repos for package.json and install deps
for repo_dir in /workspace/*/; do
    if [ -d "$repo_dir" ] && [ -f "$repo_dir/package.json" ]; then
        install_workspace_deps "$repo_dir"
        # Also check for monorepo structure (apps/cli for prlt)
        if [ -f "$repo_dir/apps/cli/package.json" ]; then
            install_workspace_deps "$repo_dir/apps/cli"
        fi
    fi
done

# PRLT-1114: Install pre-commit hook to catch secrets before they are committed
# Uses core.hooksPath so the hook applies to all repos the agent touches
setup_secret_detection_hook() {
    local hooks_dir="/home/node/.git-hooks"
    mkdir -p "$hooks_dir"

    cat > "$hooks_dir/pre-commit" << 'HOOKEOF'
#!/bin/bash
# Pre-commit hook: prevent committing secrets (PRLT-1114)
# Scans staged changes for known API key / token patterns.

SECRET_PATTERNS='lin_api_[A-Za-z0-9]|ghp_[A-Za-z0-9]|gho_[A-Za-z0-9]|ghs_[A-Za-z0-9]|xox[bprs]-[A-Za-z0-9]|sk-[A-Za-z0-9]{20,}'

if git diff --cached --diff-filter=d -U0 | grep -qE "$SECRET_PATTERNS"; then
    echo "ERROR: Possible secret detected in staged changes!" >&2
    echo "" >&2
    echo "Matched lines:" >&2
    git diff --cached --diff-filter=d -U0 | grep -nE "$SECRET_PATTERNS" | head -5 >&2
    echo "" >&2
    echo "Remove the secret before committing." >&2
    exit 1
fi
HOOKEOF

    chmod +x "$hooks_dir/pre-commit"
    /usr/bin/git config --global core.hooksPath "$hooks_dir"
    echo "Secret detection pre-commit hook installed"
}

setup_secret_detection_hook

echo "Workspace setup complete"
`
}

/**
 * Generate container entrypoint script.
 * PRLT-1089: Watches for startup scripts in /tmp and auto-launches tmux sessions.
 * This ensures agents start even if the host-side docker exec fails.
 */
export function generateEntrypointScript(): string {
  return `#!/bin/bash
# Container entrypoint - auto-starts tmux sessions for startup scripts
# PRLT-1089: Containers would start but tmux sessions wouldn't launch
# if the host-side docker exec failed. This entrypoint watches for
# startup scripts deposited in /tmp and automatically executes them.

# Background watcher: monitor /tmp for prlt startup scripts
(
  while true; do
    for script in /tmp/prlt-*.sh; do
      [ -f "\$script" ] || continue
      [ -x "\$script" ] || continue
      # Skip already-processed scripts
      [ -f "\${script}.started" ] && continue
      # Extract session name from script path: /tmp/prlt-{sessionName}.sh
      session_name=\$(basename "\$script" .sh | sed 's/^prlt-//')
      # Check if tmux session already exists (host may have created it)
      if ! tmux has-session -t "\$session_name" 2>/dev/null; then
        echo "[entrypoint] Auto-starting tmux session '\$session_name' from \$script"
        tmux new-session -d -s "\$session_name" -n "\$session_name" "bash \$script"
      fi
      # Mark as processed regardless (host or entrypoint may have created it)
      touch "\${script}.started"
    done
    sleep 2
  done
) &

# Keep container alive
exec sleep infinity
`
}

/**
 * Create .devcontainer/ directory structure for an agent
 * Writes devcontainer.json, Dockerfile, and init-firewall.sh
 */
export function createDevcontainerConfig(options: DevcontainerOptions, config?: ExecutionConfig): void {
  const devcontainerDir = path.join(options.agentDir, '.devcontainer')

  // Create .devcontainer directory
  fs.mkdirSync(devcontainerDir, { recursive: true })

  // Generate and write devcontainer.json
  const devcontainerJson = generateDevcontainerJson(options, config)
  const devcontainerJsonPath = path.join(devcontainerDir, 'devcontainer.json')
  fs.writeFileSync(devcontainerJsonPath, JSON.stringify(devcontainerJson, null, 2) + '\n')

  // Generate and write Dockerfile
  const dockerfile = generateDockerfile(options)
  const dockerfilePath = path.join(devcontainerDir, 'Dockerfile')
  fs.writeFileSync(dockerfilePath, dockerfile)

  // Generate and write firewall script (executor-aware for API domain whitelisting)
  // Merge workspace-level allowlist with per-action/spawn allowlist
  const allAllowlistDomains = [
    ...(config?.firewall.allowlistDomains ?? []),
    ...(options.networkAllowlist ?? []),
  ]
  const firewallScript = generateFirewallScript(options.executor, allAllowlistDomains)
  const firewallScriptPath = path.join(devcontainerDir, 'init-firewall.sh')
  fs.writeFileSync(firewallScriptPath, firewallScript, { mode: 0o755 })

  // Generate and write prlt setup script
  const setupScript = generatePrltSetupScript()
  const setupScriptPath = path.join(devcontainerDir, 'setup-prlt.sh')
  fs.writeFileSync(setupScriptPath, setupScript, { mode: 0o755 })

  // Generate and write container entrypoint script (PRLT-1089)
  const entrypointScript = generateEntrypointScript()
  const entrypointScriptPath = path.join(devcontainerDir, 'entrypoint.sh')
  fs.writeFileSync(entrypointScriptPath, entrypointScript, { mode: 0o755 })
}

// =============================================================================
// Orchestrator Docker Support
// =============================================================================

export interface OrchestratorDockerOptions {
  /** Orchestrator name (e.g., 'main') */
  orchestratorName: string
  /** HQ root directory path */
  hqPath: string
  /** Timezone for the container */
  timezone?: string
  /** prlt channel: "npm", "npm:dev", "gh", "mount", or version like "npm:1.2.3" */
  prltChannel?: string
  /** Executor type - determines which CLI tools to install */
  executor?: ExecutorType
  /** Git user.name for commit attribution */
  gitUserName?: string
  /** Git user.email for commit attribution */
  gitUserEmail?: string
}

/**
 * Generate a Dockerfile for the orchestrator container.
 *
 * The orchestrator container is designed for the sibling container pattern:
 * - Docker socket is mounted from the host so the orchestrator can spawn
 *   agent containers as siblings (not nested Docker-in-Docker)
 * - HQ directory is mounted for workspace access
 * - prlt CLI is installed for orchestration commands
 * - No firewall needed since orchestrator needs to manage Docker
 */
export function generateOrchestratorDockerfile(options: OrchestratorDockerOptions): string {
  const timezone = options.timezone || 'America/Los_Angeles'

  return `FROM node:22

# Ensure we run as root for apt-get and system setup
USER root

ARG TZ=${timezone}
ENV TZ=\${TZ}

# Install system dependencies (no iptables/ipset - orchestrator doesn't use firewall)
RUN apt-get update && apt-get install -y \\
    less git git-lfs procps sudo fzf zsh man-db unzip gnupg2 gh tmux \\
    jq nano vim curl docker.io \\
    && rm -rf /var/lib/apt/lists/* \\
    && git lfs install

# Create workspace and claude directories
RUN mkdir -p /workspace /hq /home/node/.claude \\
    && chown -R node:node /workspace /hq /home/node/.claude

# Add node user to docker group so it can use Docker socket
RUN groupadd -f docker && usermod -aG docker node

# Set up persistent bash history
RUN mkdir -p /commandhistory \\
    && touch /commandhistory/.bash_history \\
    && chown -R node:node /commandhistory

# Install git-delta for better diffs (architecture-aware)
RUN ARCH=$(dpkg --print-architecture) && \\
    curl -L "https://github.com/dandavison/delta/releases/download/0.18.2/git-delta_0.18.2_\${ARCH}.deb" -o /tmp/delta.deb && \\
    dpkg -i /tmp/delta.deb && \\
    rm /tmp/delta.deb

# Install zsh with oh-my-zsh
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended \\
    && chsh -s /bin/zsh node

# Configure npm global directory
RUN mkdir -p /home/node/.npm-global/bin /home/node/.npm-global/lib \\
    && chown -R node:node /home/node/.npm-global
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.npm-global/bin:/usr/local/bin:/usr/bin:/bin

# Install pnpm and executor CLI as node user
# CC_VERSION: pinned @anthropic-ai/claude-code version (e.g., "2.1.80") or empty for latest
ARG CC_VERSION=
USER node
RUN npm install -g pnpm && npm install -g @anthropic-ai/claude-code\${CC_VERSION:+@\${CC_VERSION}}${options.executor === 'codex' ? ' && npm install -g @openai/codex' : ''}
USER root

# Install prlt CLI
ARG PRLT_REGISTRY=npm
ARG PRLT_VERSION=latest
RUN if [ "\${PRLT_REGISTRY}" = "npm" ] || [ "\${PRLT_REGISTRY}" = "gh" ]; then \\
      echo "Installing @proletariat/cli@\${PRLT_VERSION} from npm..." && \\
      npm install -g @proletariat/cli@\${PRLT_VERSION}; \\
    else \\
      echo "prlt will be mounted from host (mount mode)"; \\
    fi

# Copy entrypoint script (PRLT-1089: auto-start tmux sessions)
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Set default editor
ENV EDITOR=nano

# Configure shell history
ENV HISTFILE=/commandhistory/.bash_history

USER node
WORKDIR /hq
`
}

/**
 * Check if agent has devcontainer configuration
 */
export function hasDevcontainerConfig(agentDir: string): boolean {
  const devcontainerJsonPath = path.join(agentDir, '.devcontainer', 'devcontainer.json')
  return fs.existsSync(devcontainerJsonPath)
}

/**
 * Read existing devcontainer.json
 */
export function readDevcontainerJson(agentDir: string): DevcontainerJson | null {
  const devcontainerJsonPath = path.join(agentDir, '.devcontainer', 'devcontainer.json')

  if (!fs.existsSync(devcontainerJsonPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(devcontainerJsonPath, 'utf-8')
    return JSON.parse(content) as DevcontainerJson
  } catch {
    return null
  }
}

/**
 * Update devcontainer.json with new mounts (e.g., when new repo worktrees are added)
 *
 * Note: With the simplified mount strategy (entire agent workspace), this is mainly
 * for backwards compatibility or if someone wants to customize mounts.
 */
export function updateDevcontainerMounts(agentDir: string, _repoWorktrees: string[]): void {
  const devcontainerJson = readDevcontainerJson(agentDir)

  if (!devcontainerJson) {
    return
  }

  // Use single mount for entire workspace - includes all repos and temp files
  // NOTE: ~/.claude.json is COPIED (not mounted) to /workspace/.claude.json
  // to avoid corruption from concurrent writes by multiple containers
  // TKT-801: Use consistency=cached to reduce grpcfuse contention on Docker Desktop
  devcontainerJson.mounts = [
    'source=${localWorkspaceFolder},target=/workspace,type=bind,consistency=cached',
    'source=claude-bash-history,target=/commandhistory,type=volume',
    'source=claude-credentials,target=/home/node/.claude,type=volume',
  ]

  // Write back
  const devcontainerJsonPath = path.join(agentDir, '.devcontainer', 'devcontainer.json')
  fs.writeFileSync(devcontainerJsonPath, JSON.stringify(devcontainerJson, null, 2) + '\n')
}

/**
 * Get list of repo directories inside the agent workspace.
 * With the full workspace mount, this returns all non-hidden subdirectories
 * (excluding .devcontainer).
 */
export function getMountedRepos(agentDir: string): string[] {
  try {
    const entries = fs.readdirSync(agentDir, { withFileTypes: true })
    return entries
      .filter((entry) => {
        // Include directories that are not hidden and not .devcontainer
        return entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          entry.name !== '.devcontainer'
      })
      .map((entry) => entry.name)
  } catch {
    return []
  }
}
