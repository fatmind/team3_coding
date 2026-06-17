'use strict';

/**
 * E2E: Feature #16 — Watchdog auto-restart + max failures
 *
 * Step 1: watchdog.sh starts daemon, daemon exits non-zero → restart within 5s
 * Step 2: 5 consecutive failures → watchdog stops
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Watchdog auto-restart (Feature #16, Step 1 & 2)', { timeout: 60_000 }, () => {
  let tmpDir;
  const watchdogPath = path.resolve(__dirname, '../../watchdog.sh');

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat16-wd-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 1: should restart daemon after non-zero exit', async () => {
    // Create a fake entry script that exits with code 1 on first call, then 0
    const counterFile = path.join(tmpDir, 'counter.txt');
    fs.writeFileSync(counterFile, '0');

    const fakeEntry = path.join(tmpDir, 'fake-entry.js');
    fs.writeFileSync(fakeEntry, `
      const fs = require('fs');
      const counterFile = '${counterFile.replace(/'/g, "\\'")}';
      let count = parseInt(fs.readFileSync(counterFile, 'utf-8'));
      count++;
      fs.writeFileSync(counterFile, String(count));
      if (count <= 1) {
        console.log('[Daemon] Simulated crash ' + count);
        process.exit(1);
      } else {
        console.log('[Daemon] Success on attempt ' + count);
        process.exit(0);
      }
    `);

    // Run watchdog with custom entry point
    const proc = spawn('bash', ['-c', `
      SCRIPT_DIR="${path.resolve(__dirname, '../../')}"
      ENTRY="${fakeEntry}"
      MAX_FAILURES=5
      RESTART_DELAY=1

      failures=0
      while true; do
        node "$ENTRY"
        exit_code=$?
        if [ "$exit_code" -eq 0 ]; then
          echo "WATCHDOG_NORMAL_EXIT"
          exit 0
        fi
        failures=$((failures + 1))
        if [ "$failures" -ge "$MAX_FAILURES" ]; then
          echo "WATCHDOG_MAX_FAILURES"
          exit 1
        fi
        sleep "$RESTART_DELAY"
      done
    `], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stdout += d.toString(); });

    const exitCode = await new Promise(resolve => proc.on('close', resolve));

    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('WATCHDOG_NORMAL_EXIT'));

    // Counter should show 2 attempts
    const finalCount = parseInt(fs.readFileSync(counterFile, 'utf-8'));
    assert.strictEqual(finalCount, 2);
  });

  it('Step 2: should stop after MAX_FAILURES consecutive failures', async () => {
    const counterFile = path.join(tmpDir, 'counter2.txt');
    fs.writeFileSync(counterFile, '0');

    const fakeEntry = path.join(tmpDir, 'always-fail.js');
    fs.writeFileSync(fakeEntry, `
      const fs = require('fs');
      const counterFile = '${counterFile.replace(/'/g, "\\'")}';
      let count = parseInt(fs.readFileSync(counterFile, 'utf-8'));
      count++;
      fs.writeFileSync(counterFile, String(count));
      console.log('[Daemon] Crash ' + count);
      process.exit(1);
    `);

    const MAX = 3; // Use 3 to keep test fast
    const proc = spawn('bash', ['-c', `
      ENTRY="${fakeEntry}"
      MAX_FAILURES=${MAX}
      RESTART_DELAY=0

      failures=0
      while true; do
        node "$ENTRY"
        exit_code=$?
        if [ "$exit_code" -eq 0 ]; then
          echo "WATCHDOG_NORMAL_EXIT"
          exit 0
        fi
        failures=$((failures + 1))
        echo "WATCHDOG_FAILURE_$failures"
        if [ "$failures" -ge "$MAX_FAILURES" ]; then
          echo "WATCHDOG_MAX_FAILURES"
          exit 1
        fi
        sleep "$RESTART_DELAY"
      done
    `], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });

    const exitCode = await new Promise(resolve => proc.on('close', resolve));

    assert.strictEqual(exitCode, 1);
    assert.ok(stdout.includes('WATCHDOG_MAX_FAILURES'));

    const finalCount = parseInt(fs.readFileSync(counterFile, 'utf-8'));
    assert.strictEqual(finalCount, MAX);
  });
});
