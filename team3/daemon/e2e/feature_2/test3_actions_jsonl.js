'use strict';

/**
 * Integration Test: arch startup writes actions.jsonl (Feature #2, Step 5)
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js
 *
 * Flow:
 * 1. initAgent('arch') spawns real claude code (real child process)
 * 2. claude receives the -p prompt about writing actions.jsonl
 * 3. claude executes the instruction and writes notification to actions.jsonl
 * 4. Test verifies actions.jsonl contains the arch notification
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const { initAgent } = require('../../src/init-agent');

describe('E2E: arch actions.jsonl notification via REAL claude (Step 5)', { timeout: 120_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let actionsJsonlPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat2-real-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');
    actionsJsonlPath = path.join(specDir, 'actions.jsonl');

    // Create project structure
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      init_daemon: process.pid,
      daemon_heart: new Date().toISOString(),
    }, null, 2));

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'),
      '# Arch Agent\n你是架构师 agent。按照 -p 收到的指示执行操作，完成后退出。不做指示之外的任何操作。');
    fs.writeFileSync(actionsJsonlPath, '');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 5: real claude receives prompt and writes actions.jsonl', async () => {
    // Use real claude CLI — override spawnFn to set cwd to tmpDir
    // so relative paths in the prompt (spec/actions.jsonl) resolve correctly
    function realSpawn(cmd, args, opts) {
      return spawn(cmd, args, {
        ...opts,
        cwd: tmpDir,
      });
    }

    const result = await initAgent('arch', {
      projectJsonPath,
      specDir,
      spawnFn: realSpawn,
    });

    // Wait for real claude to complete (typically 5-30s)
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('claude timed out after 90s')), 90_000);
      result.process.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      result.process.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    assert.strictEqual(exitCode, 0, 'real claude should exit with code 0');

    // Verify: actions.jsonl has arch notification (written by REAL claude, not by test!)
    const content = fs.readFileSync(actionsJsonlPath, 'utf-8').trim();
    assert.ok(content.length > 0, 'actions.jsonl should not be empty after arch init');

    const lines = content.split('\n').filter(l => l.trim());
    assert.ok(lines.length >= 1, 'actions.jsonl should have at least 1 line');

    // Verify the notification is valid JSONL with correct schema
    const lastAction = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(lastAction.action, 'to_human', 'action should be to_human');
    assert.strictEqual(lastAction.from, 'arch', 'from should be arch');
    assert.strictEqual(lastAction.to, 'human', 'to should be human');
    assert.ok(lastAction.ts > 0, 'should have valid timestamp');
    assert.ok(typeof lastAction.message === 'string' && lastAction.message.length > 0,
      'should have non-empty message');

    console.log('[PASS] Step 5: REAL claude spawned, wrote to actions.jsonl');
    console.log('  Message:', lastAction.message);
  });

  it('Step 5 (format): notification follows actions.jsonl schema', async () => {
    const content = fs.readFileSync(actionsJsonlPath, 'utf-8').trim();
    if (!content) {
      // Skip if previous test didn't produce content (shouldn't happen)
      console.log('[SKIP] No content in actions.jsonl');
      return;
    }

    const lines = content.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const action = JSON.parse(line);
      assert.ok('action' in action, 'must have action field');
      assert.ok('from' in action, 'must have from field');
      assert.ok('to' in action, 'must have to field');
      assert.ok('ts' in action, 'must have ts field');
      assert.ok('message' in action, 'must have message field');
      assert.strictEqual(typeof action.ts, 'number');
    }

    console.log('[PASS] Step 5 (format): all actions follow schema');
  });
});
