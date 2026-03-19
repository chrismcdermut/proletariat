# Switching Install Methods

Proletariat CLI (`prlt`) supports three installation methods: **Homebrew**, **npm**, and **standalone**. Having multiple methods installed simultaneously causes path conflicts. This guide explains how to cleanly switch between them.

## The Problem

When multiple install methods coexist, you may see:

- **npm**: `EEXIST: file already exists` — npm finds a binary from brew at `/opt/homebrew/bin/prlt`
- **brew**: `already installed` on upgrade — brew tap is stale or a different version is shadowing the brew binary
- **standalone**: `command not found` — `~/.local/bin` is not in your `PATH`, or another install method takes precedence

These issues happen because each method places the `prlt` binary in a different location, and your shell's `PATH` determines which one runs.

## Where Each Method Installs

| Method | Binary path | Library path |
|--------|-------------|--------------|
| Homebrew (Apple Silicon) | `/opt/homebrew/bin/prlt` | `/opt/homebrew/lib/node_modules/@proletariat/cli/` |
| Homebrew (Intel Mac) | `/usr/local/bin/prlt` | `/usr/local/lib/node_modules/@proletariat/cli/` |
| npm global | `$(npm config get prefix)/bin/prlt` | `$(npm config get prefix)/lib/node_modules/@proletariat/cli/` |
| Standalone | `~/.local/bin/prlt` | `~/.local/lib/proletariat/` |

Check which one is active:

```bash
which prlt
```

## Switching from Homebrew to npm

```bash
# 1. Remove Homebrew installation
brew uninstall prlt

# 2. (Optional) Remove the tap
brew untap chrismcdermut/proletariat

# 3. Install via npm
npm install -g @proletariat/cli

# 4. Verify
which prlt      # Should show npm global path
prlt --version
```

## Switching from Homebrew to Standalone

```bash
# 1. Remove Homebrew installation
brew uninstall prlt

# 2. (Optional) Remove the tap
brew untap chrismcdermut/proletariat

# 3. Install standalone
curl -fsSL https://raw.githubusercontent.com/chrismcdermut/proletariat/main/scripts/install.sh | bash

# 4. Ensure ~/.local/bin is in your PATH (the installer will remind you)
# 5. Verify
which prlt      # Should show ~/.local/bin/prlt
prlt --version
```

## Switching from npm to Homebrew

```bash
# 1. Remove npm global installation
npm uninstall -g @proletariat/cli

# 2. Install via Homebrew
brew install chrismcdermut/proletariat/prlt

# 3. Verify
which prlt      # Should show /opt/homebrew/bin/prlt or /usr/local/bin/prlt
prlt --version
```

## Switching from npm to Standalone

```bash
# 1. Remove npm global installation
npm uninstall -g @proletariat/cli

# 2. Install standalone
curl -fsSL https://raw.githubusercontent.com/chrismcdermut/proletariat/main/scripts/install.sh | bash

# 3. Ensure ~/.local/bin is in your PATH
# 4. Verify
which prlt
prlt --version
```

## Switching from Standalone to Homebrew

```bash
# 1. Remove standalone installation
rm -rf ~/.local/lib/proletariat ~/.local/bin/prlt

# 2. Install via Homebrew
brew install chrismcdermut/proletariat/prlt

# 3. Verify
which prlt
prlt --version
```

## Switching from Standalone to npm

```bash
# 1. Remove standalone installation
rm -rf ~/.local/lib/proletariat ~/.local/bin/prlt

# 2. Install via npm
npm install -g @proletariat/cli

# 3. Verify
which prlt
prlt --version
```

## Detecting Your Current Install Method

```bash
# See which binary is running
which prlt

# prlt detects it automatically
prlt update --check --json | grep packageManager
```

You can also force the detection with an environment variable:

```bash
export PRLT_MANAGED_BY=brew       # or: npm, standalone
```

## Updating

Each install method has its own update mechanism:

| Method | Update command |
|--------|---------------|
| Homebrew | `brew upgrade chrismcdermut/proletariat/prlt` |
| npm | `npm install -g @proletariat/cli` |
| Standalone | `prlt update` |
| Any | `prlt update` (auto-detects method) |

The `prlt update` command works with all install methods — it detects how prlt was installed and runs the appropriate update command.

## Troubleshooting

### npm fails with EEXIST

A binary from another install method already exists at the target path. Uninstall the conflicting method first (see sections above).

### brew upgrade says "already installed"

Your Homebrew tap may be stale:

```bash
brew tap --force chrismcdermut/proletariat
brew upgrade chrismcdermut/proletariat/prlt
```

### Standalone binary not found after install

Ensure `~/.local/bin` is in your `PATH`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Wrong version running

Check if multiple installations exist:

```bash
which -a prlt
```

If you see multiple paths, remove the ones you don't want (see switching instructions above).
