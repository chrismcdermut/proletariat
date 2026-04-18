import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Unit tests for the CI smoke test script (PRLT-1343).
 *
 * Validates that the smoke test script exists, is well-formed,
 * and covers the expected set of CLI commands.
 */
describe('@smoke CI Smoke Test Script validation (PRLT-1343)', () => {
  const scriptPath = path.resolve(__dirname, '../../../../scripts/ci-smoke-test.sh');
  let scriptContent: string;

  before(() => {
    scriptContent = fs.readFileSync(scriptPath, 'utf-8');
  });

  it('should exist on disk', () => {
    expect(fs.existsSync(scriptPath)).to.be.true;
  });

  it('should be executable (has shebang)', () => {
    expect(scriptContent).to.match(/^#!\/usr\/bin\/env bash/);
  });

  it('should use strict mode (set -euo pipefail)', () => {
    expect(scriptContent).to.include('set -euo pipefail');
  });

  it('should clean up temp directory on exit', () => {
    expect(scriptContent).to.match(/trap .* EXIT/);
  });

  it('should test prlt --help', () => {
    expect(scriptContent).to.include('prlt --help');
  });

  it('should test prlt --version', () => {
    expect(scriptContent).to.include('prlt --version');
  });

  it('should test prlt new (HQ creation)', () => {
    expect(scriptContent).to.include('prlt new');
  });

  it('should test prlt ticket list', () => {
    expect(scriptContent).to.include('prlt ticket list');
  });

  it('should test prlt db repair', () => {
    expect(scriptContent).to.include('prlt db repair');
  });

  it('should test prlt work start', () => {
    expect(scriptContent).to.include('prlt work start');
  });

  it('should test prlt work ship', () => {
    expect(scriptContent).to.include('prlt work ship');
  });

  it('should test prlt whoami', () => {
    expect(scriptContent).to.include('prlt whoami');
  });

  it('should exit non-zero on any failure', () => {
    expect(scriptContent).to.include('exit 1');
  });

  it('should report pass/fail counts', () => {
    expect(scriptContent).to.include('PASS=');
    expect(scriptContent).to.include('FAIL=');
  });
});
