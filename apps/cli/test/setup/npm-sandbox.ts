/**
 * Mocha root hook: global npm prefix sandbox (PRLT-1276).
 *
 * Sets PRLT_NPM_MODULES_DIR_OVERRIDE to a safe dummy path so that no test
 * can accidentally operate on the host's real global npm prefix. Individual
 * tests that exercise backup/restore logic create their own temp prefix and
 * override the env var in beforeEach; this root hook is a safety net that
 * catches any code path that forgets to set the override.
 *
 * Without this, a bug or missing setup in a single test could wipe the
 * globally installed prlt binary — exactly the PRLT-1276 failure mode.
 */

import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const sandboxDir = mkdtempSync(join(tmpdir(), 'prlt-npm-test-sandbox-'))

process.env.PRLT_NPM_MODULES_DIR_OVERRIDE = join(sandboxDir, 'lib', 'node_modules')
