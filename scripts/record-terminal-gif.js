#!/usr/bin/env node
/**
 * Record a terminal demo as an asciicast v2 file, then convert to GIF.
 *
 * Prerequisites (no root required):
 *   npm install -g terminalizer  (optional, not used here)
 *   curl -sL "https://github.com/asciinema/agg/releases/latest/download/agg-$(uname -m)-unknown-linux-gnu" -o /tmp/agg && chmod +x /tmp/agg
 *
 * Usage:
 *   node scripts/record-terminal-gif.js          # produces demo.cast + demo.gif
 *   /tmp/agg demo.cast demo.gif --speed 1.5      # re-render with different speed
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CAST_FILE = path.join(__dirname, '..', 'demo.cast');
const GIF_FILE = path.join(__dirname, '..', 'demo.gif');
const AGG_BIN = '/tmp/agg';

// Commands to record — edit this list to change the demo
const commands = [
  { cmd: 'prlt --version', delay: 0.5 },
  { cmd: 'prlt whoami', delay: 0.8 },
  { cmd: 'prlt ticket show TKT-265 2>&1 | head -25', delay: 1.0 },
  { cmd: 'prlt ticket list 2>&1 | head -20', delay: 1.0 },
  { cmd: 'echo "Demo complete - GIF recorded from inside Docker!"', delay: 0.5 },
];

const COLS = 100;
const ROWS = 30;

// --- asciicast v2 generation ---

const header = {
  version: 2,
  width: COLS,
  height: ROWS,
  timestamp: Math.floor(Date.now() / 1000),
  title: 'prlt demo - terminal GIF from Docker',
  env: { SHELL: '/bin/zsh', TERM: 'xterm-256color' },
};

const events = [JSON.stringify(header)];
let time = 0.0;

function addOutput(t, text) {
  events.push(JSON.stringify([t, 'o', text]));
}

function typeCommand(cmd, startTime) {
  let t = startTime;
  addOutput(t, '\x1b[1;32m$ \x1b[0m');
  t += 0.1;
  for (const ch of cmd) {
    addOutput(t, ch);
    t += 0.03 + Math.random() * 0.05;
  }
  t += 0.1;
  addOutput(t, '\r\n');
  return t;
}

for (const { cmd, delay } of commands) {
  time = typeCommand(cmd, time);
  time += 0.2;

  let output;
  try {
    output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 15000,
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, FORCE_COLOR: '1', TERM: 'xterm-256color' },
    });
  } catch (e) {
    output = e.stdout || e.stderr || `(command failed: ${e.message})`;
  }

  for (const line of output.split('\n')) {
    addOutput(time, line + '\r\n');
    time += 0.02;
  }
  time += delay;
}

addOutput(time, '\x1b[1;32m$ \x1b[0m');

fs.writeFileSync(CAST_FILE, events.join('\n') + '\n');
console.log(`Recorded ${events.length} events over ${time.toFixed(1)}s to ${CAST_FILE}`);

// --- convert to GIF with agg ---

if (!fs.existsSync(AGG_BIN)) {
  console.error(`agg not found at ${AGG_BIN}. Install it with:`);
  console.error(`  curl -sL "https://github.com/asciinema/agg/releases/latest/download/agg-$(uname -m)-unknown-linux-gnu" -o ${AGG_BIN} && chmod +x ${AGG_BIN}`);
  process.exit(1);
}

console.log('Converting to GIF...');
execSync(`${AGG_BIN} ${CAST_FILE} ${GIF_FILE} --speed 1.5`, { stdio: 'inherit' });
console.log(`GIF saved to ${GIF_FILE}`);
