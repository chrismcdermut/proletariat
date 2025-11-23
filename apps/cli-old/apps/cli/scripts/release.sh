#!/bin/bash

# Release script for PROLETARIAT CLI
set -e

echo "🚀 Preparing to release @proletariat/cli"

# Check we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Must run from apps/cli directory"
    exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Uncommitted changes detected. Please commit first."
    exit 1
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Ask for version bump type
echo "How should we bump the version?"
echo "1) patch (0.1.3 -> 0.1.4)"
echo "2) minor (0.1.3 -> 0.2.0)"
echo "3) major (0.1.3 -> 1.0.0)"
read -p "Select (1/2/3): " VERSION_TYPE

case $VERSION_TYPE in
    1) VERSION_BUMP="patch";;
    2) VERSION_BUMP="minor";;
    3) VERSION_BUMP="major";;
    *) echo "Invalid selection"; exit 1;;
esac

# Clean and build
echo "🧹 Cleaning..."
npm run clean

echo "🔨 Building..."
npm run build

# Bump version
echo "📝 Bumping version..."
npm version $VERSION_BUMP

NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"

# Create git tag
git add package.json package-lock.json
git commit -m "Release v$NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release version $NEW_VERSION"

# Publish to npm
echo "📦 Publishing to npm..."
npm publish --access public

# Push to GitHub
echo "🌐 Pushing to GitHub..."
git push origin main --tags

echo "✅ Successfully released v$NEW_VERSION!"
echo ""
echo "📋 Post-release checklist:"
echo "  - Update GitHub release notes"
echo "  - Tweet about the release"
echo "  - Update any documentation"