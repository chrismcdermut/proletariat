#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import {execute} from '@oclif/core'

// Support -v as shorthand for --version (only when it's the sole argument,
// to avoid conflicts with command-specific -v flags like repo create --visibility)
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '-v') {
  process.argv[2] = '--version'
}

await execute({development: true, dir: import.meta.url})
