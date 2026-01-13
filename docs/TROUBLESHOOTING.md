# Troubleshooting

## Native Module Errors

### Symptoms

You may see errors like:

```
dlopen(...better_sqlite3.node...): not a mach-o file
```

```
Error: The module was compiled against a different Node.js version
```

```
Error: wrong ELF class: ELFCLASS64
```

```
Error: Module did not self-register
```

### Causes

Native Node.js modules like `better-sqlite3` compile platform-specific binaries during installation. These binaries become invalid when:

1. **Node.js version mismatch** - The module was compiled against a different Node.js ABI version
2. **Architecture mismatch** - x86 binary on ARM/Apple Silicon (or vice versa)
3. **Cross-environment contamination** - `node_modules` copied from Docker, another machine, or CI
4. **Workspace linking issues** - pnpm link from workspace with different Node version

### Quick Fixes

**Option 1: Rebuild just better-sqlite3**
```bash
pnpm rebuild better-sqlite3
```

**Option 2: Clean install**
```bash
rm -rf node_modules && pnpm install
```

**Option 3: Full clean (if issues persist)**
```bash
rm -rf node_modules
rm -rf apps/*/node_modules
pnpm store prune
pnpm install
```

### Prevention

1. **Use the pinned Node.js version**
   - Check `.nvmrc` for the expected version
   - Use `nvm use` or `fnm use` to switch versions

2. **Don't copy node_modules**
   - Always run `pnpm install` on each machine
   - Don't copy node_modules between Docker and host

3. **Check your Node.js version before starting**
   ```bash
   node --version  # Should match .nvmrc
   ```

### CI/CD Considerations

The CI workflow explicitly rebuilds native modules after installation to ensure platform-appropriate binaries:

```yaml
- name: Rebuild native modules
  run: pnpm rebuild better-sqlite3
```

If you're setting up a new CI environment, ensure:
1. Node.js version matches the `.nvmrc` file (20.x)
2. Native modules are rebuilt after `pnpm install`
3. Each platform (Linux, macOS) runs its own build

### Debugging

Set `DEBUG=1` when running the CLI to see detailed error information:

```bash
DEBUG=1 prlt <command>
```

### Other Native Module Dependencies

While `better-sqlite3` is the primary native dependency, the same principles apply to other native modules you might add:
- `sharp` (image processing)
- `canvas` (2D graphics)
- `bcrypt` (password hashing)

Always rebuild native modules after Node.js upgrades or when moving between platforms.
