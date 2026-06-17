'use strict';

/**
 * Feature #10 e2e: init_agent creates a fresh CLI session without legacy state.
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Checkpoint Steps covered:
 *   Step 1: init_agent writes session.runing
 *   Step 2: init_agent uses --session-id, never --resume
 *   Step 3: init_agent does not write legacy session.initialized
 *
 * Strategy for non-zero exit test: override spawnFn to force --resume with
 * a brand new UUID (no existing session), causing real claude to fail.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const { initAgent } = require('../../src/init-agent');

describe('Feature #10 - init_agent session creation with REAL claude', { timeout: 180_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-real-init-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    // Create spec/agents directory with prompt files
    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'),
      '# Arch Agent\n你是测试用 arch agent。收到消息后只回复 "确认收到"，不做任何其他操作。');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'),
      '# UAT Agent\n你是测试用 uat agent。收到消息后只回复 "确认收到"。');

    // Create minimal .team3-project.json
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      init_daemon: 12345,
    }, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write runing and never write legacy initialized after exit code 0', async () => {
    const result = await initAgent('arch', {
      projectJsonPath,
      specDir,
      spawnFn: (cmd, args, opts) => {
        // Use real claude CLI with cwd set to tmpDir
        return spawn(cmd, args, { ...opts, cwd: tmpDir });
      },
    });

    const dataImmediate = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.strictEqual(dataImmediate.partner.arch_agent.session.runing, result.sessionId);
    assert.strictEqual(dataImmediate.partner.arch_agent.session.initialized, undefined,
      'initialized should not be written immediately after spawn');

    // Wait for real claude process to exit
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('claude timed out')), 90_000);
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

    await new Promise(r => setTimeout(r, 200));
    const dataAfter = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.strictEqual(dataAfter.partner.arch_agent.session.initialized, undefined,
      'initialized should not be written after exit code 0');

    // Verify real claude used --session-id (init always creates new session)
    assert.ok(result.args.includes('--session-id'), 'should use --session-id');
    assert.ok(!result.args.includes('--resume'), 'should NOT use --resume');

    console.log('[PASS] init_agent writes runing, uses --session-id, and skips initialized');
    console.log('  Session ID:', result.sessionId);
  });

  it('should not write initialized after non-zero exit code', async () => {
    const result = await initAgent('uat', {
      projectJsonPath,
      specDir,
      spawnFn: (cmd, args, opts) => {
        // Override: replace --session-id with --resume to force failure
        // Real claude will fail with "No conversation found" for a UUID
        // that has no existing session
        const modifiedArgs = args.map(a => a === '--session-id' ? '--resume' : a);
        return spawn(cmd, modifiedArgs, { ...opts, cwd: tmpDir });
      },
    });

    // Wait for process to exit
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('claude timed out')), 90_000);
      result.process.on('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      result.process.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    assert.notStrictEqual(exitCode, 0, 'claude should exit non-zero when resuming non-existent session');

    await new Promise(r => setTimeout(r, 200));
    const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.strictEqual(data.partner.uat_agent.session.initialized, undefined,
      'initialized should not be written after non-zero exit');

    console.log('[PASS] init_agent skips initialized after non-zero exit');
  });
});
