/**
 * Devcontainer Template Generator
 *
 * Generates .devcontainer/ configuration for agent sandboxed execution.
 * Uses a custom Dockerfile with network firewall for security sandboxing.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { ExecutionConfig, DEFAULT_EXECUTION_CONFIG } from './types.js'

export interface DevcontainerOptions {
  agentName: string
  agentDir: string
  repoWorktrees?: string[]  // Names of repo worktrees to mount
  memory?: string
  cpus?: number
  timezone?: string
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
 * Uses a custom Dockerfile with firewall for network sandboxing.
 * Mounts the entire agent workspace directory so all contents (repos, prompt files, etc.)
 * are accessible inside the container at /workspace.
 */
export function generateDevcontainerJson(options: DevcontainerOptions, config?: ExecutionConfig): DevcontainerJson {
  const cfg = config || DEFAULT_EXECUTION_CONFIG

  const devcontainerJson: DevcontainerJson = {
    name: `Agent: ${options.agentName}`,
    build: {
      dockerfile: 'Dockerfile',
      args: {
        TZ: options.timezone || 'America/Los_Angeles',
      },
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
    mounts: [
      'source=${localWorkspaceFolder},target=/workspace,type=bind',
      'source=claude-bash-history,target=/commandhistory,type=volume',
      'source=claude-credentials,target=/home/node/.claude,type=volume',
      // NOTE: ~/.claude.json is COPIED (not mounted) to /workspace/.claude.json
      // to avoid corruption from concurrent writes by multiple containers
      'source=${localEnv:PRLT_HQ_PATH}/.proletariat,target=/hq/.proletariat,type=bind',
      // PMO path can be anywhere (e.g., /hq/pmo or /hq/repos/myrepo/pmo)
      // Use PRLT_PMO_PATH env var to mount the actual location to /hq/pmo
      'source=${localEnv:PRLT_PMO_PATH},target=/hq/pmo,type=bind',
      // NOTE: PRLT_REPO_PATH mount removed - prlt is now installed via npm in the container
      // Mount the main repo's .git directory so git worktrees can resolve their parent
      // Worktree .git files reference paths like /Users/.../repos/proletariat/.git/worktrees/name
      // This mount makes those paths accessible inside the container at /hq/repos/proletariat
      'source=${localEnv:PRLT_HQ_PATH}/repos/proletariat,target=/hq/repos/proletariat,type=bind',
    ],
    containerEnv: {
      DEVCONTAINER: 'true',
      ANTHROPIC_API_KEY: '${localEnv:ANTHROPIC_API_KEY}',
      // GH_TOKEN enables gh CLI in container (for PR creation, etc.)
      GH_TOKEN: '${localEnv:GH_TOKEN}',
      GITHUB_TOKEN: '${localEnv:GITHUB_TOKEN}',
      PRLT_HQ_PATH: '/hq',
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

  return `FROM node:20

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

# Install Claude Code as node user so files are owned correctly
USER node
RUN npm install -g @anthropic-ai/claude-code
USER root

# Install prlt CLI from GitHub Packages
# Requires GITHUB_TOKEN build arg with read:packages scope
ARG GITHUB_TOKEN
RUN if [ -n "\${GITHUB_TOKEN}" ]; then \\
      echo "//npm.pkg.github.com/:_authToken=\${GITHUB_TOKEN}" >> /home/node/.npmrc && \\
      echo "@chrismcdermut:registry=https://npm.pkg.github.com" >> /home/node/.npmrc && \\
      npm install -g @chrismcdermut/prlt && \\
      rm /home/node/.npmrc; \\
    else \\
      echo "GITHUB_TOKEN not provided, prlt will be mounted from host"; \\
    fi

# Copy and set up scripts
COPY init-firewall.sh /usr/local/bin/init-firewall.sh
COPY setup-prlt.sh /usr/local/bin/setup-prlt.sh
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/setup-prlt.sh

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
 * Whitelists only necessary domains for Claude Code operation.
 */
export function generateFirewallScript(): string {
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

# Add other allowed domains
add_domain "api.anthropic.com"
add_domain "console.anthropic.com"
add_domain "statsigapi.net"
add_domain "sentry.io"
add_domain "registry.npmjs.org"
add_domain "npmjs.com"
add_domain "nodejs.org"
add_domain "update.code.visualstudio.com"
add_domain "vscode.download.prss.microsoft.com"

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
# Worktree .git files contain host paths like: gitdir: /Users/.../repos/proletariat/.git/worktrees/name
# Inside container, the parent repo is mounted at /hq/repos/proletariat
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
    # Format is: gitdir: /path/to/parent/.git/worktrees/name
    HOST_PATH="$(sed -n 's/^gitdir: *//p' "$GIT_FILE")"

    # Check if it's a host path that needs translation
    case "$HOST_PATH" in
        /Users/*|/home/*)
            WORKTREE_NAME="$(basename "$HOST_PATH")"
            CONTAINER_PATH="/hq/repos/proletariat/.git/worktrees/$WORKTREE_NAME"
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

# Set up git wrapper for worktree path translation
setup_git_wrapper

# Copy Claude credentials from workspace to home (each container gets its own copy)
if [ -f "/workspace/.claude.json" ]; then
    cp /workspace/.claude.json /home/node/.claude.json
    echo "Claude credentials copied"
fi

# Configure git to use GitHub token for authentication
# Check for token in environment or get from gh CLI
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
    echo "Warning: No GitHub token found, push to GitHub will require manual auth"
fi

# Check if prlt is already installed globally (via npm from GitHub Packages)
if command -v prlt &> /dev/null; then
    PRLT_PATH=$(which prlt)
    if [[ "$PRLT_PATH" == "/home/node/.npm-global/bin/prlt" ]]; then
        echo "prlt installed via npm, no setup needed"
        exit 0
    fi
fi

# Check if mounted prlt exists at /opt/prlt
if [ -d "/opt/prlt/apps/cli" ]; then
    echo "Setting up mounted prlt..."

    PRLT_LOCAL="/home/node/.prlt-local"

    # Only rebuild if not already done
    if [ ! -f "$PRLT_LOCAL/.setup-complete" ]; then
        echo "Rebuilding native modules for container architecture..."
        mkdir -p "$PRLT_LOCAL"

        # Install only better-sqlite3 with correct architecture
        cd "$PRLT_LOCAL"
        npm init -y > /dev/null 2>&1
        npm install better-sqlite3@11.6.0 --build-from-source 2>&1 || {
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
    echo "prlt wrapper ready at $WRAPPER"
else
    echo "No mounted prlt found, skipping setup"
fi
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

  // Generate and write firewall script
  const firewallScript = generateFirewallScript()
  const firewallScriptPath = path.join(devcontainerDir, 'init-firewall.sh')
  fs.writeFileSync(firewallScriptPath, firewallScript, { mode: 0o755 })

  // Generate and write prlt setup script
  const setupScript = generatePrltSetupScript()
  const setupScriptPath = path.join(devcontainerDir, 'setup-prlt.sh')
  fs.writeFileSync(setupScriptPath, setupScript, { mode: 0o755 })
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
  devcontainerJson.mounts = [
    'source=${localWorkspaceFolder},target=/workspace,type=bind',
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
