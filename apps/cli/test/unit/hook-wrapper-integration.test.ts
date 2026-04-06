import { expect } from 'chai'
import { execSync } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WRAPPER_PATH = path.resolve(__dirname, '../../bin/hook-wrapper.sh')

/**
 * TKT-009: Integration tests for hook-wrapper.sh
 *
 * Verifies that the wrapper script correctly handles:
 * - Valid JSON passthrough
 * - Empty stdin (abnormal termination)
 * - Malformed JSON (truncated data)
 *
 * These are regression tests: if the fix is reverted, the malformed/empty
 * stdin tests will fail because the downstream command would receive invalid JSON.
 *
 * NOTE: execSync is used intentionally here — we need shell piping to simulate
 * stdin behavior. All inputs are hardcoded test constants, not user input.
 */
describe('TKT-009: hook-wrapper.sh integration', () => {
  it('should pass through valid JSON unchanged', () => {
    const input = '{"event":"Stop","session_id":"abc123"}'
    const output = execSync(`echo '${input}' | bash "${WRAPPER_PATH}"`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()

    const parsed = JSON.parse(output)
    expect(parsed).to.deep.equal({ event: 'Stop', session_id: 'abc123' })
  })

  it('should produce valid JSON for empty stdin', () => {
    // Use printf '' to guarantee truly empty stdin (echo -n may still produce a newline)
    const output = execSync(`printf '' | bash "${WRAPPER_PATH}"`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()

    const parsed = JSON.parse(output)
    expect(parsed).to.have.property('hook_wrapper', 'fallback')
    expect(parsed).to.have.property('reason', 'empty_stdin')
  })

  it('should produce valid JSON for malformed input', () => {
    // Simulate truncated JSON that would cause the original crash:
    // "failed to parse hook data: invalid character s looking for beginning of value"
    const malformed = 'some garbage that is not json'
    const output = execSync(`echo '${malformed}' | bash "${WRAPPER_PATH}"`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()

    const parsed = JSON.parse(output)
    expect(parsed).to.have.property('hook_wrapper', 'fallback')
    expect(parsed).to.have.property('reason', 'invalid_json')
    expect(parsed).to.have.property('raw_truncated').that.is.a('string')
  })

  it('should handle truncated JSON gracefully', () => {
    // Simulate a JSON payload that got cut off mid-stream
    const truncated = '{"event":"Stop","session_id":"abc'
    const output = execSync(`echo '${truncated}' | bash "${WRAPPER_PATH}"`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()

    const parsed = JSON.parse(output)
    expect(parsed).to.have.property('hook_wrapper', 'fallback')
    expect(parsed).to.have.property('reason', 'invalid_json')
  })

  it('should pass JSON to wrapped command via stdin', () => {
    const input = '{"event":"Stop"}'
    // Use cat as the wrapped command — it should receive the JSON
    const output = execSync(`echo '${input}' | bash "${WRAPPER_PATH}" cat`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()

    expect(JSON.parse(output)).to.deep.equal({ event: 'Stop' })
  })

  it('should pass fallback JSON to wrapped command on malformed input', () => {
    const output = execSync(`echo 'not json' | bash "${WRAPPER_PATH}" cat`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()

    const parsed = JSON.parse(output)
    expect(parsed).to.have.property('hook_wrapper', 'fallback')
  })
})
