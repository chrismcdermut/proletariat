#!/usr/bin/env bash
# install.sh — Standalone installer for @proletariat/cli (prlt)
#
# Installs prlt into ~/.local/ to avoid conflicts with Homebrew and npm global.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/chrismcdermut/proletariat/main/scripts/install.sh | bash
#
# Or with a specific version:
#   curl -fsSL ... | bash -s -- --version 0.3.72
#
# Environment variables:
#   PRLT_INSTALL_DIR  — Override install prefix (default: ~/.local)
#   PRLT_VERSION      — Override version to install (default: latest)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
NPM_PACKAGE="@proletariat/cli"
INSTALL_DIR="${PRLT_INSTALL_DIR:-$HOME/.local}"
BIN_DIR="${INSTALL_DIR}/bin"
LIB_DIR="${INSTALL_DIR}/lib/proletariat"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
VERSION="${PRLT_VERSION:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --prefix)
      INSTALL_DIR="$2"
      BIN_DIR="${INSTALL_DIR}/bin"
      LIB_DIR="${INSTALL_DIR}/lib/proletariat"
      shift 2
      ;;
    --help|-h)
      echo "Usage: install.sh [--version VERSION] [--prefix DIR]"
      echo ""
      echo "Install prlt (Proletariat CLI) to ~/.local/bin."
      echo ""
      echo "Options:"
      echo "  --version VERSION   Install a specific version (default: latest)"
      echo "  --prefix DIR        Install prefix (default: ~/.local)"
      echo ""
      echo "Environment variables:"
      echo "  PRLT_INSTALL_DIR    Same as --prefix"
      echo "  PRLT_VERSION        Same as --version"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { echo "  → $*"; }
error() { echo "ERROR: $*" >&2; exit 1; }

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
echo ""
echo "Proletariat CLI Installer"
echo "========================="
echo ""

# Require Node.js
if ! command_exists node; then
  error "Node.js is required but not found. Install Node.js 20+ first: https://nodejs.org"
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  error "Node.js 20+ is required (found v$(node -p process.version)). Please upgrade."
fi
info "Node.js $(node --version) detected"

# Require npm (for rebuilding native modules)
if ! command_exists npm; then
  error "npm is required but not found. It should come with Node.js."
fi

# ---------------------------------------------------------------------------
# Check for conflicting installations
# ---------------------------------------------------------------------------
if command_exists prlt; then
  EXISTING_PATH="$(which prlt 2>/dev/null || true)"
  if [ -n "$EXISTING_PATH" ]; then
    case "$EXISTING_PATH" in
      /opt/homebrew/*|/usr/local/Cellar/*|/usr/local/bin/prlt)
        echo ""
        echo "⚠️  Found existing Homebrew installation at: $EXISTING_PATH"
        echo "   To avoid conflicts, uninstall the Homebrew version first:"
        echo ""
        echo "     brew uninstall prlt"
        echo ""
        echo "   Or see: https://github.com/chrismcdermut/proletariat/blob/main/docs/switching-install-methods.md"
        echo ""
        ;;
      */node_modules/*)
        echo ""
        echo "⚠️  Found existing npm global installation at: $EXISTING_PATH"
        echo "   To avoid conflicts, uninstall the npm version first:"
        echo ""
        echo "     npm uninstall -g @proletariat/cli"
        echo ""
        echo "   Or see: https://github.com/chrismcdermut/proletariat/blob/main/docs/switching-install-methods.md"
        echo ""
        ;;
    esac
  fi
fi

# ---------------------------------------------------------------------------
# Resolve version
# ---------------------------------------------------------------------------
if [ -z "$VERSION" ]; then
  info "Fetching latest version from npm registry…"
  VERSION=$(curl -fsSL "https://registry.npmjs.org/${NPM_PACKAGE}/latest" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf-8")).version')
fi

if [ -z "$VERSION" ]; then
  error "Could not determine latest version. Try: install.sh --version 0.3.72"
fi

info "Installing prlt v${VERSION}"

# ---------------------------------------------------------------------------
# Download tarball
# ---------------------------------------------------------------------------
TARBALL_URL="https://registry.npmjs.org/${NPM_PACKAGE}/-/cli-${VERSION}.tgz"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

info "Downloading ${TARBALL_URL}…"
HTTP_CODE=$(curl -fsSL -o "$WORK_DIR/package.tgz" -w '%{http_code}' "$TARBALL_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" != "200" ]; then
  error "Failed to download tarball (HTTP ${HTTP_CODE}). Check that version ${VERSION} exists."
fi

# ---------------------------------------------------------------------------
# Extract and install
# ---------------------------------------------------------------------------
info "Installing to ${LIB_DIR}/"

# Create directories
mkdir -p "$BIN_DIR"
mkdir -p "$LIB_DIR"

# Remove previous standalone installation if present
if [ -d "$LIB_DIR/node_modules" ]; then
  info "Removing previous installation…"
  rm -rf "$LIB_DIR"
  mkdir -p "$LIB_DIR"
fi

# Extract tarball — npm tarballs have a 'package/' prefix
tar xzf "$WORK_DIR/package.tgz" -C "$WORK_DIR"

# Move package contents to lib dir
cp -R "$WORK_DIR/package/"* "$LIB_DIR/"

# Install production dependencies
info "Installing dependencies (this may take a moment)…"
cd "$LIB_DIR"
npm install --production --no-audit --no-fund 2>&1 | tail -1 || true

# Rebuild native modules for the current Node.js version
info "Building native modules…"
npm rebuild better-sqlite3 2>&1 | tail -1 || true

# ---------------------------------------------------------------------------
# Create symlink
# ---------------------------------------------------------------------------
info "Creating symlink: ${BIN_DIR}/prlt"

# Remove existing symlink/file if present
rm -f "$BIN_DIR/prlt"

# Create symlink to the CLI entry point
ln -s "$LIB_DIR/bin/run.js" "$BIN_DIR/prlt"

# Ensure the entry point is executable
chmod +x "$LIB_DIR/bin/run.js"

# ---------------------------------------------------------------------------
# Write install metadata (for update detection)
# ---------------------------------------------------------------------------
cat > "$LIB_DIR/.install-metadata.json" <<JSON
{
  "install_method": "standalone",
  "install_dir": "${INSTALL_DIR}",
  "version": "${VERSION}",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

# ---------------------------------------------------------------------------
# Verify installation
# ---------------------------------------------------------------------------
info "Verifying installation…"

if "$BIN_DIR/prlt" --version >/dev/null 2>&1; then
  INSTALLED_VERSION=$("$BIN_DIR/prlt" --version 2>/dev/null || echo "unknown")
  echo ""
  echo "✅ prlt v${VERSION} installed successfully!"
  echo "   Binary: ${BIN_DIR}/prlt"
  echo "   Library: ${LIB_DIR}/"
  echo ""
else
  echo ""
  echo "⚠️  Installation complete but verification failed."
  echo "   Binary: ${BIN_DIR}/prlt"
  echo "   Try running: ${BIN_DIR}/prlt --version"
  echo ""
fi

# ---------------------------------------------------------------------------
# PATH guidance
# ---------------------------------------------------------------------------
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo "📌 Add ${BIN_DIR} to your PATH:"
  echo ""

  SHELL_NAME=$(basename "${SHELL:-/bin/bash}")
  case "$SHELL_NAME" in
    zsh)
      RC_FILE="~/.zshrc"
      ;;
    bash)
      if [ -f "$HOME/.bash_profile" ]; then
        RC_FILE="~/.bash_profile"
      else
        RC_FILE="~/.bashrc"
      fi
      ;;
    fish)
      echo "   fish_add_path ${BIN_DIR}"
      echo ""
      echo "   Then restart your shell or run: exec fish"
      exit 0
      ;;
    *)
      RC_FILE="~/.profile"
      ;;
  esac

  echo "   echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ${RC_FILE}"
  echo ""
  echo "   Then restart your shell or run: source ${RC_FILE}"
fi

echo ""
echo "To update later:  prlt update"
echo "To uninstall:     rm -rf ${LIB_DIR} ${BIN_DIR}/prlt"
echo ""
