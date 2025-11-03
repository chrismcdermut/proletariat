#!/bin/bash

# Proletariat Installation Script
# Installs the prlt command globally

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🚀 Proletariat Installer${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Determine installation directory
INSTALL_DIR="$HOME/.proletariat"
BIN_DIR="$HOME/.local/bin"

# Create directories
echo -e "${CYAN}Creating directories...${NC}"
mkdir -p "$INSTALL_DIR/scripts"
mkdir -p "$BIN_DIR"
echo -e "${GREEN}✓ Directories created${NC}"

# Copy scripts
echo -e "${CYAN}Installing scripts...${NC}"
SCRIPT_DIR="$(dirname "$0")/scripts"

if [[ -d "$SCRIPT_DIR" ]]; then
    cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/scripts/"
    chmod +x "$INSTALL_DIR/scripts/"*.sh
    echo -e "${GREEN}✓ Scripts installed${NC}"
else
    echo -e "${RED}Error: Scripts directory not found${NC}"
    exit 1
fi

# Create main prlt command
echo -e "${CYAN}Creating prlt command...${NC}"

cat > "$BIN_DIR/prlt" << 'EOF'
#!/bin/bash

# Proletariat CLI
# Main entry point

# Find installation directory
PRLT_HOME="$HOME/.proletariat"

if [[ ! -d "$PRLT_HOME/scripts" ]]; then
    echo "Error: Proletariat not installed properly"
    echo "Run: curl -sSL https://raw.githubusercontent.com/proletariat/proletariat/main/install.sh | bash"
    exit 1
fi

# Delegate to main script
exec "$PRLT_HOME/scripts/prlt-main.sh" "$@"
EOF

chmod +x "$BIN_DIR/prlt"
echo -e "${GREEN}✓ prlt command created${NC}"

# Check if bin is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo
    echo -e "${YELLOW}⚠️  $BIN_DIR is not in your PATH${NC}"
    echo
    echo "Add this to your shell config (~/.bashrc, ~/.zshrc, etc.):"
    echo -e "${CYAN}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
    echo
    
    # Offer to add it
    read -p "Add to shell config now? [Y/n]: " ADD_PATH
    if [[ ! "$ADD_PATH" =~ ^[Nn]$ ]]; then
        # Detect shell
        if [[ -n "$ZSH_VERSION" ]]; then
            SHELL_CONFIG="$HOME/.zshrc"
        elif [[ -n "$BASH_VERSION" ]]; then
            SHELL_CONFIG="$HOME/.bashrc"
        else
            SHELL_CONFIG="$HOME/.profile"
        fi
        
        echo >> "$SHELL_CONFIG"
        echo "# Proletariat" >> "$SHELL_CONFIG"
        echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_CONFIG"
        
        echo -e "${GREEN}✓ Added to $SHELL_CONFIG${NC}"
        echo "Run: source $SHELL_CONFIG"
    fi
fi

# Create example project structure
echo
read -p "Create example project? [Y/n]: " CREATE_EXAMPLE

if [[ ! "$CREATE_EXAMPLE" =~ ^[Nn]$ ]]; then
    EXAMPLE_DIR="$HOME/proletariat-example"
    
    echo -e "${CYAN}Creating example at $EXAMPLE_DIR...${NC}"
    
    mkdir -p "$EXAMPLE_DIR"
    cd "$EXAMPLE_DIR"
    git init
    
    # Run init
    "$INSTALL_DIR/scripts/prlt-init-simple.sh" <<< ""
    
    echo -e "${GREEN}✓ Example created at $EXAMPLE_DIR${NC}"
fi

# Summary
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Installation Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "Installed to: $INSTALL_DIR"
echo "Command: $BIN_DIR/prlt"
echo
echo -e "${CYAN}Quick Start:${NC}"
echo "  1. cd to your project directory"
echo "  2. Run: prlt init"
echo "  3. Run: prlt help"
echo
echo -e "${CYAN}Key Commands:${NC}"
echo "  prlt init                # Initialize project"
echo "  prlt go <agent>          # Switch to agent workspace"
echo "  prlt claim [ticket]      # Claim ticket & launch Claude"
echo "  prlt add                 # Create new ticket"
echo "  prlt status              # Show project status"
echo
echo -e "${CYAN}Documentation:${NC}"
echo "  https://github.com/proletariat/proletariat"
echo
echo -e "${CYAN}Happy coding! 🚀${NC}"