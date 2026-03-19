# Workflow Fix: better-sqlite3 CI flaky postinstall (PRLT-1044)

## Problem
The unit-tests CI job lacks the better-sqlite3 native binding cache restore and
rebuild-with-retry pattern that the build and e2e-tests jobs already have.

## How to apply
A patch file is available at `fix-better-sqlite3.patch` in this branch.
To apply it from the host machine (with a token that has `workflow` scope):

```bash
git checkout PRLT-1044/feat/chrismcdermut/sassy-horowitz/fix-flaky-better-sql
git am < fix-better-sqlite3.patch
git push origin HEAD
```

## Note
The agent's GitHub OAuth token lacks the `workflow` scope required to push
changes to `.github/workflows/` files. The patch must be applied by a human
or a token with the `workflow` scope.
