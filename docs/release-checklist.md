# Release Checklist

Steps to publish a new version of `@proletariat/cli` and verify distribution across all channels.

## Pre-Release

- [ ] All tests pass (`cd apps/cli && pnpm build && pnpm test`)
- [ ] CHANGELOG.md updated with new version entry
- [ ] Version bumped in `apps/cli/package.json`

## Publish to npm

- [ ] Publish: `cd apps/cli && npm publish --access public`
- [ ] Verify npm listing: `npm view @proletariat/cli version`
- [ ] Verify install: `npm install -g @proletariat/cli && prlt --version`

## Update Homebrew Tap

- [ ] Download new tarball and compute SHA256:
  ```bash
  VERSION=<new-version>
  curl -sL "https://registry.npmjs.org/@proletariat/cli/-/cli-${VERSION}.tgz" -o /tmp/prlt-cli.tgz
  shasum -a 256 /tmp/prlt-cli.tgz
  ```
- [ ] Update `Formula/prlt.rb` in `chrismcdermut/homebrew-proletariat`:
  - Set `url` to new tarball URL
  - Set `sha256` to new hash
- [ ] Push formula update to `chrismcdermut/homebrew-proletariat`

## Homebrew Verification — macOS arm64 (Apple Silicon)

Run on an Apple Silicon Mac (M1/M2/M3/M4):

```bash
# Clean install
brew update
brew install chrismcdermut/proletariat/prlt
prlt --version
# Expected: @proletariat/cli/<VERSION> darwin-arm64 node-v<X>

# Or upgrade existing install
brew update
brew upgrade prlt
prlt --version

# Verify binary resolves correctly
which prlt
# Expected: /opt/homebrew/bin/prlt

# Quick smoke test
prlt --help
```

- [ ] `prlt --version` shows correct version
- [ ] `which prlt` resolves to `/opt/homebrew/bin/prlt`
- [ ] `prlt --help` runs without errors

## Homebrew Verification — macOS x86_64 (Intel)

Run on an Intel Mac (or Rosetta):

```bash
# Clean install
brew update
brew install chrismcdermut/proletariat/prlt
prlt --version
# Expected: @proletariat/cli/<VERSION> darwin-x64 node-v<X>

# Or upgrade existing install
brew update
brew upgrade prlt
prlt --version

# Verify binary resolves correctly
which prlt
# Expected: /usr/local/bin/prlt

# Quick smoke test
prlt --help
```

- [ ] `prlt --version` shows correct version
- [ ] `which prlt` resolves to `/usr/local/bin/prlt`
- [ ] `prlt --help` runs without errors

## Post-Release

- [ ] Git tag created: `git tag v<VERSION> && git push origin v<VERSION>`
- [ ] GitHub release created (if applicable)
- [ ] Verify `brew audit --strict chrismcdermut/proletariat/prlt` passes (no warnings)
