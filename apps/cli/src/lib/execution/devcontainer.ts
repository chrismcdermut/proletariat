/**
 * Devcontainer Template Generator
 *
 * Generates .devcontainer/ configuration for agent sandboxed execution.
 * Uses a custom Dockerfile with network firewall for security sandboxing.
 */

import * as fs from 'fs'
import * as path from 'path'
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
        GITHUB_TOKEN: '${localEnv:GITHUB_TOKEN}',
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
      'source=${localEnv:PRLT_HQ_PATH}/pmo,target=/hq/pmo,type=bind',
      'source=${localEnv:PRLT_REPO_PATH},target=/opt/prlt,type=bind,readonly',
    ],
    containerEnv: {
      ANTHROPIC_API_KEY: '${localEnv:ANTHROPIC_API_KEY}',
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

ARG TZ=${timezone}
ENV TZ=\${TZ}
ENV DEVCONTAINER=true

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    less git procps sudo fzf zsh man-db unzip gnupg2 gh \\
    iptables ipset iproute2 dnsutils jq nano vim \\
    && rm -rf /var/lib/apt/lists/*

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

# Create ipset for allowed domains
ipset create allowed-domains hash:ip -exist

# Allow localhost
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

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

# Fetch GitHub IP ranges
echo "Fetching GitHub IP ranges..."
GITHUB_IPS=$(curl -s https://api.github.com/meta 2>/dev/null | jq -r '.git[]?, .api[]?, .web[]?' 2>/dev/null || true)
for cidr in $GITHUB_IPS; do
    if [[ $cidr =~ ^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+/[0-9]+$ ]]; then
        # Add base IP of CIDR range
        base_ip=$(echo $cidr | cut -d'/' -f1)
        ipset add allowed-domains $base_ip -exist 2>/dev/null || true
    fi
done

# Add allowed domains
add_domain "api.anthropic.com"
add_domain "console.anthropic.com"
add_domain "statsigapi.net"
add_domain "sentry.io"
add_domain "registry.npmjs.org"
add_domain "npmjs.com"
add_domain "nodejs.org"
add_domain "update.code.visualstudio.com"
add_domain "vscode.download.prss.microsoft.com"

# Get host network and allow it
HOST_NETWORK=$(ip route | grep default | awk '{print $3}' | head -1)
if [ -n "$HOST_NETWORK" ]; then
    HOST_SUBNET=$(echo $HOST_NETWORK | sed 's/\\.[0-9]*$/.0\\/24/')
    iptables -A OUTPUT -d $HOST_SUBNET -j ACCEPT
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

echo "Firewall setup complete."
`
}

/**
 * Generate prlt setup script.
 * Rebuilds better-sqlite3 if prlt is mounted from host (not installed via npm).
 */
export function generatePrltSetupScript(): string {
  return `#!/bin/bash
# Setup prlt CLI - rebuild native modules if using mounted version

# Copy Claude credentials from workspace to home (each container gets its own copy)
if [ -f "/workspace/.claude.json" ]; then
    cp /workspace/.claude.json /home/node/.claude.json
    echo "Claude credentials copied"
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
