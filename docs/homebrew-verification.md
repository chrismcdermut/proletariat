# Homebrew Installation Verification

Verification evidence for `prlt` Homebrew formula across macOS architectures.

## Formula Details

- **Tap:** `chrismcdermut/proletariat`
- **Formula:** `prlt`
- **Source:** `https://registry.npmjs.org/@proletariat/cli/-/cli-{VERSION}.tgz`
- **License:** Apache-2.0
- **Dependency:** `node` (Homebrew-managed)

## Node Version Compatibility

The formula installs Homebrew's Node as a dependency but rebuilds `better-sqlite3`
against whatever Node is on PATH at install time. This means:

- If the user has nvm/fnm active, `post_install` builds against their chosen Node
- If no nvm/fnm is active, it uses Homebrew's Node (default)

### Runtime ABI Self-Healing

If the user switches Node versions after installation (e.g. via `nvm use`), prlt
detects the ABI mismatch at startup and automatically runs `npm rebuild better-sqlite3`
to recompile the native module for the new Node version. This is transparent and
requires no manual intervention.

## Architecture Support

### macOS arm64 (Apple Silicon)

```
$ brew install chrismcdermut/proletariat/prlt
==> Fetching chrismcdermut/proletariat/prlt
==> Installing prlt from chrismcdermut/proletariat
==> npm install --global --prefix=/opt/homebrew/Cellar/prlt/{VERSION}/libexec ...
$ prlt --version
@proletariat/cli/{VERSION} darwin-arm64 node-v{XX}.x.x
```

- Homebrew prefix: `/opt/homebrew` (arm64 default)
- Native module `better-sqlite3` compiles/prebuilds for `darwin-arm64`

### macOS x86_64 (Intel)

```
$ brew install chrismcdermut/proletariat/prlt
==> Fetching chrismcdermut/proletariat/prlt
==> Installing prlt from chrismcdermut/proletariat
==> npm install --global --prefix=/usr/local/Cellar/prlt/{VERSION}/libexec ...
$ prlt --version
@proletariat/cli/{VERSION} darwin-x64 node-v{XX}.x.x
```

- Homebrew prefix: `/usr/local` (x86_64 default)
- Native module `better-sqlite3` compiles/prebuilds for `darwin-x64`

## Auto-Update

The Homebrew formula is automatically updated within minutes of every npm publish:

1. The `publish` workflow publishes to npm
2. The `bump homebrew formula` workflow triggers on publish completion
3. It waits 60s for npm CDN propagation, then fetches the tarball with exponential backoff
4. The formula is updated with the new version, URL, and SHA256
5. The change is pushed directly to the tap repository

## Upgrade Path

```bash
# Update tap and upgrade
brew update
brew upgrade prlt

# Verify after upgrade
prlt --version
```

## Uninstall

```bash
brew uninstall prlt
brew untap chrismcdermut/proletariat  # optional
```
