/**
 * Devcontainer Template Generator
 *
 * Generates .devcontainer/ configuration for agent sandboxed execution.
 * Uses a custom Dockerfile with network firewall for security sandboxing.
 *
 * Supports multiple language runtimes (polyglot mode):
 * - node: Node.js 20 (always included for prlt CLI)
 * - python: Python 3.12 with pip and uv
 * - go: Go 1.22 with module support
 * - rust: Rust stable with cargo
 * - ruby: Ruby 3.3 with bundler
 * - java: OpenJDK 21 with Maven and Gradle
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { ExecutionConfig, DEFAULT_EXECUTION_CONFIG } from './types.js'
import { parseChannel } from '../workspace-config.js'

export type MountMode = 'worktree' | 'clone'

// =============================================================================
// Language Stack Configuration
// =============================================================================

/**
 * Supported language runtimes.
 * 'node' is always included as it's required for prlt CLI.
 */
export type LanguageStack = 'node' | 'python' | 'go' | 'rust' | 'ruby' | 'java'

/**
 * All available language stacks with descriptions
 */
export const LANGUAGE_STACKS: Record<LanguageStack, { name: string; description: string; tools: string[] }> = {
  node: {
    name: 'Node.js',
    description: 'Node.js 20 with npm, pnpm, and yarn',
    tools: ['node', 'npm', 'pnpm', 'yarn'],
  },
  python: {
    name: 'Python',
    description: 'Python 3.12 with pip, uv, and pipx',
    tools: ['python3', 'pip', 'uv', 'pipx'],
  },
  go: {
    name: 'Go',
    description: 'Go 1.22 with module support',
    tools: ['go', 'gofmt', 'gopls'],
  },
  rust: {
    name: 'Rust',
    description: 'Rust stable with cargo and rustfmt',
    tools: ['rustc', 'cargo', 'rustfmt', 'clippy'],
  },
  ruby: {
    name: 'Ruby',
    description: 'Ruby 3.3 with bundler and gem',
    tools: ['ruby', 'gem', 'bundler'],
  },
  java: {
    name: 'Java',
    description: 'OpenJDK 21 with Maven and Gradle',
    tools: ['java', 'javac', 'mvn', 'gradle'],
  },
}

/**
 * Default language stacks (Node.js only for backwards compatibility)
 */
export const DEFAULT_LANGUAGES: LanguageStack[] = ['node']

/**
 * Parse a comma-separated language string into an array of LanguageStack.
 * Always includes 'node' as it's required for prlt.
 */
export function parseLanguages(languageStr?: string): LanguageStack[] {
  if (!languageStr) {
    return DEFAULT_LANGUAGES
  }

  const requested = languageStr
    .toLowerCase()
    .split(',')
    .map(l => l.trim())
    .filter(l => l in LANGUAGE_STACKS) as LanguageStack[]

  // Always include node
  if (!requested.includes('node')) {
    requested.unshift('node')
  }

  // Remove duplicates
  return [...new Set(requested)]
}

/**
 * Validate language stack names.
 * Returns valid languages and invalid ones separately.
 */
export function validateLanguages(languages: string[]): { valid: LanguageStack[]; invalid: string[] } {
  const valid: LanguageStack[] = []
  const invalid: string[] = []

  for (const lang of languages) {
    const normalized = lang.toLowerCase().trim()
    if (normalized in LANGUAGE_STACKS) {
      valid.push(normalized as LanguageStack)
    } else {
      invalid.push(lang)
    }
  }

  // Always include node
  if (!valid.includes('node')) {
    valid.unshift('node')
  }

  return { valid: [...new Set(valid)], invalid }
}

export interface DevcontainerOptions {
  agentName: string
  agentDir: string
  repoWorktrees?: string[]  // Names of repo worktrees to mount (only needed for worktree mode)
  memory?: string
  cpus?: number
  timezone?: string
  /** prlt channel: "npm", "npm:dev", "gh", "gh:dev", "mount", or version like "npm:1.2.3" */
  prltChannel?: string
  /** Mount mode: 'worktree' needs parent repo mounts + git wrapper, 'clone' is self-contained */
  mountMode?: MountMode
  /** Language stacks to install (default: ['node']) */
  languages?: LanguageStack[]
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

  // For GitHub Packages, pass GITHUB_TOKEN as build arg
  if (channel.registry === 'gh') {
    buildArgs.GITHUB_TOKEN = '${localEnv:GITHUB_TOKEN}'
  }

  // Build mounts array - parent repo mounts only needed for worktree mode
  const mounts: string[] = [
    'source=${localWorkspaceFolder},target=/workspace,type=bind',
    'source=claude-bash-history,target=/commandhistory,type=volume',
    'source=claude-credentials,target=/home/node/.claude,type=volume',
    // NOTE: ~/.claude.json is COPIED (not mounted) to /workspace/.claude.json
    // to avoid corruption from concurrent writes by multiple containers
    // NOTE: SSH agent socket mounting doesn't work reliably on Docker Desktop for Mac
    // So we use HTTPS + token approach instead. The token is fetched fresh at spawn time.
    'source=${localEnv:PRLT_HQ_PATH}/.proletariat,target=/hq/.proletariat,type=bind',
    // PMO path can be anywhere (e.g., /hq/pmo or /hq/repos/myrepo/pmo)
    // Use PRLT_PMO_PATH env var to mount the actual location to /hq/pmo
    'source=${localEnv:PRLT_PMO_PATH},target=/hq/pmo,type=bind',
  ]

  // Only add parent repo mounts for worktree mode
  // Worktree .git files reference paths like /Users/.../repos/{repoName}/.git/worktrees/name
  // These mounts make those paths accessible inside the container at /hq/repos/{repoName}
  // Clone mode doesn't need this because each clone has its own self-contained .git directory
  if (mountMode === 'worktree' && options.repoWorktrees) {
    for (const repoName of options.repoWorktrees) {
      mounts.push(`source=\${localEnv:PRLT_HQ_PATH}/repos/${repoName},target=/hq/repos/${repoName},type=bind`)
    }
  }

  // If using "mount" channel, mount local prlt build from PRLT_REPO_PATH
  // The setup-prlt.sh script will detect /opt/prlt and configure the wrapper
  if (useMount) {
    mounts.push('source=${localEnv:PRLT_REPO_PATH},target=/opt/prlt,type=bind,readonly')
  }

  // Get language-specific VS Code extensions
  const languages = options.languages || DEFAULT_LANGUAGES
  const vscodeExtensions = getVSCodeExtensions(languages)

  const devcontainerJson: DevcontainerJson = {
    name: `Agent: ${options.agentName}`,
    build: {
      dockerfile: 'Dockerfile',
      args: buildArgs,
    },
    customizations: {
      vscode: {
        extensions: vscodeExtensions,
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
      ANTHROPIC_API_KEY: '${localEnv:ANTHROPIC_API_KEY}',
      // GH_TOKEN enables gh CLI in container (for PR creation, etc.)
      GH_TOKEN: '${localEnv:GH_TOKEN}',
      GITHUB_TOKEN: '${localEnv:GITHUB_TOKEN}',
      PRLT_HQ_PATH: '/hq',
      // Agent identity - allows agent to know its name and host path
      PRLT_AGENT_NAME: options.agentName,
      PRLT_HOST_PATH: options.agentDir,
      // Mount mode - allows scripts to know if git wrapper is needed
      PRLT_MOUNT_MODE: mountMode,
      // Languages installed in this container (for setup scripts)
      PRLT_LANGUAGES: languages.join(','),
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
 * Get VS Code extensions based on installed languages.
 */
function getVSCodeExtensions(languages: LanguageStack[]): string[] {
  const extensions = [
    'anthropic.claude-code',
    'dbaeumer.vscode-eslint',
    'esbenp.prettier-vscode',
  ]

  if (languages.includes('python')) {
    extensions.push('ms-python.python', 'ms-python.vscode-pylance')
  }

  if (languages.includes('go')) {
    extensions.push('golang.go')
  }

  if (languages.includes('rust')) {
    extensions.push('rust-lang.rust-analyzer')
  }

  if (languages.includes('ruby')) {
    extensions.push('shopify.ruby-lsp')
  }

  if (languages.includes('java')) {
    extensions.push('redhat.java', 'vscjava.vscode-java-pack')
  }

  return extensions
}

/**
 * Generate Dockerfile content for the devcontainer.
 * Uses architecture auto-detection for cross-platform compatibility.
 * Supports multiple language runtimes (polyglot mode).
 */
export function generateDockerfile(options: DevcontainerOptions): string {
  const timezone = options.timezone || 'America/Los_Angeles'
  const languages = options.languages || DEFAULT_LANGUAGES

  // Build language installation sections
  const languageInstalls = generateLanguageInstalls(languages)
  const languageEnvVars = generateLanguageEnvVars(languages)

  return `FROM node:20

# Ensure we run as root for apt-get and system setup
USER root

ARG TZ=${timezone}
ENV TZ=\${TZ}
ENV DEVCONTAINER=true

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    less git git-lfs procps sudo fzf zsh man-db unzip gnupg2 gh tmux \\
    iptables ipset iproute2 dnsutils jq nano vim curl wget \\
    build-essential pkg-config libssl-dev \\
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

# Install pnpm and Claude Code as node user so files are owned correctly
USER node
RUN npm install -g pnpm && npm install -g @anthropic-ai/claude-code
USER root

${languageInstalls}
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
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/setup-prlt.sh

# Allow node user to run firewall script without password
RUN echo "node ALL=(ALL) NOPASSWD: /usr/local/bin/init-firewall.sh" >> /etc/sudoers

# Set default editor
ENV EDITOR=nano

# Configure shell history
ENV HISTFILE=/commandhistory/.bash_history

# Language-specific environment variables
${languageEnvVars}
USER node
WORKDIR /workspace
`
}

/**
 * Generate Dockerfile sections for installing language runtimes.
 * Each language is installed conditionally based on the languages array.
 */
function generateLanguageInstalls(languages: LanguageStack[]): string {
  const sections: string[] = []

  // Python installation
  if (languages.includes('python')) {
    sections.push(`# ============================================================================
# Python 3.12 with pip, uv, and pipx
# ============================================================================
RUN apt-get update && apt-get install -y \\
    python3 python3-pip python3-venv python3-dev \\
    && rm -rf /var/lib/apt/lists/* \\
    && ln -sf /usr/bin/python3 /usr/bin/python

# Install uv (fast Python package installer) and pipx
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \\
    && mv /root/.local/bin/uv /usr/local/bin/uv \\
    && mv /root/.local/bin/uvx /usr/local/bin/uvx \\
    && pip3 install --break-system-packages pipx \\
    && pipx ensurepath
`)
  }

  // Go installation
  if (languages.includes('go')) {
    sections.push(`# ============================================================================
# Go 1.22
# ============================================================================
RUN ARCH=$(dpkg --print-architecture) && \\
    case "\${ARCH}" in \\
      amd64) GOARCH="amd64" ;; \\
      arm64) GOARCH="arm64" ;; \\
      *) echo "Unsupported architecture: \${ARCH}" && exit 1 ;; \\
    esac && \\
    curl -L "https://go.dev/dl/go1.22.5.linux-\${GOARCH}.tar.gz" -o /tmp/go.tar.gz && \\
    tar -C /usr/local -xzf /tmp/go.tar.gz && \\
    rm /tmp/go.tar.gz

# Set up Go directories for node user
RUN mkdir -p /home/node/go/bin /home/node/go/pkg /home/node/go/src \\
    && chown -R node:node /home/node/go
`)
  }

  // Rust installation (as node user)
  if (languages.includes('rust')) {
    sections.push(`# ============================================================================
# Rust stable with cargo
# ============================================================================
USER node
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \\
    && . /home/node/.cargo/env \\
    && rustup component add rustfmt clippy
USER root
`)
  }

  // Ruby installation
  if (languages.includes('ruby')) {
    sections.push(`# ============================================================================
# Ruby 3.3 with bundler
# ============================================================================
RUN apt-get update && apt-get install -y \\
    ruby-full ruby-bundler \\
    && rm -rf /var/lib/apt/lists/* \\
    && gem install bundler

# Configure gem to install to user directory
RUN mkdir -p /home/node/.gem/ruby/bin \\
    && chown -R node:node /home/node/.gem
`)
  }

  // Java installation
  if (languages.includes('java')) {
    sections.push(`# ============================================================================
# OpenJDK 21 with Maven and Gradle
# ============================================================================
RUN apt-get update && apt-get install -y \\
    openjdk-21-jdk maven \\
    && rm -rf /var/lib/apt/lists/*

# Install Gradle
RUN GRADLE_VERSION="8.8" && \\
    curl -L "https://services.gradle.org/distributions/gradle-\${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip && \\
    unzip /tmp/gradle.zip -d /opt && \\
    ln -s /opt/gradle-\${GRADLE_VERSION} /opt/gradle && \\
    rm /tmp/gradle.zip
`)
  }

  return sections.join('\n')
}

/**
 * Generate environment variable settings for installed languages.
 */
function generateLanguageEnvVars(languages: LanguageStack[]): string {
  const envVars: string[] = []

  if (languages.includes('go')) {
    envVars.push('ENV GOPATH=/home/node/go')
    envVars.push('ENV PATH=/usr/local/go/bin:/home/node/go/bin:$PATH')
  }

  if (languages.includes('rust')) {
    envVars.push('ENV CARGO_HOME=/home/node/.cargo')
    envVars.push('ENV PATH=/home/node/.cargo/bin:$PATH')
  }

  if (languages.includes('ruby')) {
    envVars.push('ENV GEM_HOME=/home/node/.gem/ruby')
    envVars.push('ENV PATH=/home/node/.gem/ruby/bin:$PATH')
  }

  if (languages.includes('java')) {
    envVars.push('ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64')
    envVars.push('ENV PATH=/opt/gradle/bin:$PATH')
  }

  if (languages.includes('python')) {
    envVars.push('ENV PATH=/home/node/.local/bin:$PATH')
  }

  return envVars.join('\n')
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

# ============================================================================
# Language Package Manager Domains (polyglot support)
# These are added based on PRLT_LANGUAGES environment variable
# ============================================================================

# Python package managers (pypi, uv)
if [[ "\${PRLT_LANGUAGES:-node}" == *"python"* ]]; then
    echo "Adding Python package manager domains..."
    add_domain "pypi.org"
    add_domain "files.pythonhosted.org"
    add_domain "pypi.python.org"
    add_domain "astral.sh"         # uv installer
    add_domain "github.com"        # already added but explicit
fi

# Go modules proxy
if [[ "\${PRLT_LANGUAGES:-node}" == *"go"* ]]; then
    echo "Adding Go package manager domains..."
    add_domain "proxy.golang.org"
    add_domain "sum.golang.org"
    add_domain "go.dev"
    add_domain "golang.org"
    add_domain "storage.googleapis.com"
fi

# Rust/Cargo (crates.io)
if [[ "\${PRLT_LANGUAGES:-node}" == *"rust"* ]]; then
    echo "Adding Rust package manager domains..."
    add_domain "crates.io"
    add_domain "static.crates.io"
    add_domain "index.crates.io"
    add_domain "static.rust-lang.org"
    add_domain "sh.rustup.rs"
fi

# Ruby gems
if [[ "\${PRLT_LANGUAGES:-node}" == *"ruby"* ]]; then
    echo "Adding Ruby package manager domains..."
    add_domain "rubygems.org"
    add_domain "api.rubygems.org"
    add_domain "bundler.io"
fi

# Java (Maven, Gradle)
if [[ "\${PRLT_LANGUAGES:-node}" == *"java"* ]]; then
    echo "Adding Java package manager domains..."
    add_domain "repo.maven.apache.org"
    add_domain "repo1.maven.org"
    add_domain "central.sonatype.com"
    add_domain "services.gradle.org"
    add_domain "plugins.gradle.org"
    add_domain "downloads.gradle-dn.com"
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
else
    echo "No mounted prlt found, skipping setup"
fi

# ============================================================================
# Language-specific workspace dependency installation
# Uses PRLT_LANGUAGES environment variable to determine which installers to run
# ============================================================================

# Install Node.js dependencies if package.json exists
install_node_deps() {
    local workspace_dir="$1"
    if [ -f "$workspace_dir/package.json" ]; then
        echo "Installing Node.js dependencies in $workspace_dir..."
        cd "$workspace_dir"
        if [ -f "pnpm-lock.yaml" ]; then
            pnpm install 2>&1 || npm install 2>&1
        elif [ -f "package-lock.json" ]; then
            npm ci 2>&1 || npm install 2>&1
        elif [ -f "yarn.lock" ]; then
            yarn install 2>&1 || npm install 2>&1
        else
            npm install 2>&1
        fi
    fi
}

# Install Python dependencies if requirements.txt or pyproject.toml exists
install_python_deps() {
    local workspace_dir="$1"
    cd "$workspace_dir"
    if [ -f "pyproject.toml" ]; then
        echo "Installing Python dependencies (pyproject.toml) in $workspace_dir..."
        if command -v uv &>/dev/null; then
            uv pip install -e . 2>&1 || pip install -e . 2>&1
        else
            pip install -e . 2>&1
        fi
    elif [ -f "requirements.txt" ]; then
        echo "Installing Python dependencies (requirements.txt) in $workspace_dir..."
        if command -v uv &>/dev/null; then
            uv pip install -r requirements.txt 2>&1 || pip install -r requirements.txt 2>&1
        else
            pip install -r requirements.txt 2>&1
        fi
    fi
}

# Install Go modules if go.mod exists
install_go_deps() {
    local workspace_dir="$1"
    if [ -f "$workspace_dir/go.mod" ]; then
        echo "Installing Go modules in $workspace_dir..."
        cd "$workspace_dir"
        go mod download 2>&1
    fi
}

# Install Rust dependencies if Cargo.toml exists
install_rust_deps() {
    local workspace_dir="$1"
    if [ -f "$workspace_dir/Cargo.toml" ]; then
        echo "Installing Rust dependencies in $workspace_dir..."
        cd "$workspace_dir"
        cargo fetch 2>&1
    fi
}

# Install Ruby dependencies if Gemfile exists
install_ruby_deps() {
    local workspace_dir="$1"
    if [ -f "$workspace_dir/Gemfile" ]; then
        echo "Installing Ruby dependencies in $workspace_dir..."
        cd "$workspace_dir"
        bundle install 2>&1
    fi
}

# Install Java/Maven dependencies if pom.xml exists
install_java_deps() {
    local workspace_dir="$1"
    cd "$workspace_dir"
    if [ -f "pom.xml" ]; then
        echo "Installing Maven dependencies in $workspace_dir..."
        mvn dependency:resolve 2>&1 || true
    elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
        echo "Installing Gradle dependencies in $workspace_dir..."
        gradle dependencies --refresh-dependencies 2>&1 || true
    fi
}

# Main dependency installation loop
LANGUAGES="\${PRLT_LANGUAGES:-node}"
echo "Installing workspace dependencies for languages: $LANGUAGES"

for repo_dir in /workspace/*/; do
    if [ -d "$repo_dir" ]; then
        echo "Checking $repo_dir for dependencies..."

        # Always install Node.js deps (node is always enabled)
        install_node_deps "$repo_dir"
        # Also check for monorepo structure (apps/cli for prlt)
        if [ -f "$repo_dir/apps/cli/package.json" ]; then
            install_node_deps "$repo_dir/apps/cli"
        fi

        # Language-specific installers based on PRLT_LANGUAGES
        if [[ "$LANGUAGES" == *"python"* ]]; then
            install_python_deps "$repo_dir"
        fi

        if [[ "$LANGUAGES" == *"go"* ]]; then
            install_go_deps "$repo_dir"
        fi

        if [[ "$LANGUAGES" == *"rust"* ]]; then
            install_rust_deps "$repo_dir"
        fi

        if [[ "$LANGUAGES" == *"ruby"* ]]; then
            install_ruby_deps "$repo_dir"
        fi

        if [[ "$LANGUAGES" == *"java"* ]]; then
            install_java_deps "$repo_dir"
        fi
    fi
done

echo "Workspace setup complete (languages: $LANGUAGES)"
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
