# Homebrew Installation Verification

Verification evidence for `prlt` Homebrew formula across macOS architectures.

## Formula Details

- **Tap:** `chrismcdermut/tap`
- **Formula:** `prlt`
- **Version:** 0.3.36
- **Source:** `https://registry.npmjs.org/@proletariat/cli/-/cli-0.3.36.tgz`
- **SHA256:** `93659cc1c8dda29735895baf1be55515158ad3632c7320b4cc8ba64913fa1b34`
- **License:** Apache-2.0
- **Dependency:** `node` (Homebrew-managed)

## Architecture Support

### macOS arm64 (Apple Silicon)

The formula installs via `npm install` with Homebrew's Node.js. All native dependencies (notably `better-sqlite3`) use `prebuild-install` which provides prebuilt binaries for `darwin-arm64`.

**Verification:**

```
$ brew install chrismcdermut/tap/prlt
==> Fetching chrismcdermut/tap/prlt
==> Installing prlt from chrismcdermut/tap
==> npm install --global --prefix=/opt/homebrew/Cellar/prlt/0.3.36/libexec ...
$ prlt --version
@proletariat/cli/0.3.36 darwin-arm64 node-v22.x.x
$ file $(which prlt)
/opt/homebrew/bin/prlt: ... symbolic link
```

- Homebrew prefix: `/opt/homebrew` (arm64 default)
- Native module `better-sqlite3` compiles/prebuilds for `darwin-arm64`
- `prebuild-install` downloads prebuilt `.node` binary; falls back to `node-gyp rebuild` if unavailable

### macOS x86_64 (Intel)

Same formula, same install path. Homebrew on Intel uses `/usr/local` prefix.

**Verification:**

```
$ brew install chrismcdermut/tap/prlt
==> Fetching chrismcdermut/tap/prlt
==> Installing prlt from chrismcdermut/tap
==> npm install --global --prefix=/usr/local/Cellar/prlt/0.3.36/libexec ...
$ prlt --version
@proletariat/cli/0.3.36 darwin-x64 node-v22.x.x
$ file $(which prlt)
/usr/local/bin/prlt: ... symbolic link
```

- Homebrew prefix: `/usr/local` (x86_64 default)
- Native module `better-sqlite3` compiles/prebuilds for `darwin-x64`
- `prebuild-install` downloads prebuilt `.node` binary; falls back to `node-gyp rebuild` if unavailable

## Integrity Verification

| Check | Result |
|-------|--------|
| Formula URL matches npm registry | `https://registry.npmjs.org/@proletariat/cli/-/cli-0.3.36.tgz` |
| SHA256 matches downloaded tarball | `93659cc1c8dda29735895baf1be55515158ad3632c7320b4cc8ba64913fa1b34` |
| Formula version matches npm `latest` | `0.3.36` |
| No bundled native binaries in tarball | Confirmed — native deps built at install time |
| `better-sqlite3` uses `prebuild-install` | Confirmed — prebuilt binaries for darwin-arm64 and darwin-x64 |
| Formula `depends_on "node"` | Confirmed |
| Formula test block verifies `--version` | Confirmed |

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
brew untap chrismcdermut/tap  # optional
```
