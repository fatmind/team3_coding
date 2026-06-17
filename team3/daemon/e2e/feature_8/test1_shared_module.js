'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('E2E: Feature #8 - Shared claude-args module (embedded prompts)', () => {
  const srcDir = path.resolve(__dirname, '../../src');

  it('Step 1: claude-args.js exists and exports buildClaudeArgs', () => {
    const modulePath = path.join(srcDir, 'claude-args.js');
    assert.ok(fs.existsSync(modulePath), 'claude-args.js should exist');

    const mod = require(modulePath);
    assert.strictEqual(typeof mod.buildClaudeArgs, 'function',
      'Should export buildClaudeArgs function');

    const args = mod.buildClaudeArgs({
      prompt: 'test',
      sessionId: '12345678-1234-4234-8234-123456789012',
      isNew: true,
      role: 'arch',
    });
    assert.ok(Array.isArray(args));
    assert.ok(args.includes('--session-id'));
    assert.ok(args.includes('--system-prompt'));
    assert.ok(args.includes('--output-format'));

    console.log('[PASS] Step 1: Shared module exists with correct exports');
  });

  it('Step 2: init-agent.js imports and uses shared buildClaudeArgs', () => {
    const initAgentSource = fs.readFileSync(
      path.join(srcDir, 'init-agent.js'), 'utf-8'
    );

    assert.ok(
      initAgentSource.includes("require('./claude-args')"),
      'init-agent.js should require claude-args module'
    );

    const funcDefRegex = /^function buildClaudeArgs\(/m;
    assert.ok(
      !funcDefRegex.test(initAgentSource),
      'init-agent.js should NOT define its own buildClaudeArgs function'
    );

    const initAgent = require(path.join(srcDir, 'init-agent.js'));
    const claudeArgs = require(path.join(srcDir, 'claude-args.js'));
    assert.strictEqual(initAgent.buildClaudeArgs, claudeArgs.buildClaudeArgs,
      'init-agent.js should re-export the same buildClaudeArgs from claude-args');

    console.log('[PASS] Step 2: init-agent.js uses shared module');
  });

  it('Step 3: agent-scheduler.js imports and uses shared buildClaudeArgs', () => {
    const schedulerSource = fs.readFileSync(
      path.join(srcDir, 'agent-scheduler.js'), 'utf-8'
    );

    assert.ok(
      schedulerSource.includes("require('./claude-args')"),
      'agent-scheduler.js should require claude-args module'
    );

    assert.ok(
      !schedulerSource.includes("args.push('--session-id'"),
      'agent-scheduler.js should NOT have inline --session-id push'
    );

    const AgentScheduler = require(path.join(srcDir, 'agent-scheduler.js'));
    const scheduler = new AgentScheduler({
      specDir: path.resolve(__dirname, '../../../spec'),
      spawnFn: () => {},
    });

    const args = scheduler._buildArgs('arch', 'aaaaaaaa-1111-4222-8333-444444444444', true, 'test');
    assert.ok(args.includes('--session-id'));
    assert.ok(args.includes('aaaaaaaa-1111-4222-8333-444444444444'));
    assert.ok(args.includes('-p'));
    assert.ok(args.includes('test'));
    assert.ok(args.includes('--system-prompt'));

    const resumeArgs = scheduler._buildArgs('dev', 'bbbbbbbb-2222-4333-9444-555555555555', false, 'fix');
    assert.ok(resumeArgs.includes('--resume'));
    assert.ok(!resumeArgs.includes('--session-id'));

    console.log('[PASS] Step 3: agent-scheduler.js uses shared module');
  });

  it('Step 4: Both modules produce identical output for same inputs', () => {
    const claudeArgs = require(path.join(srcDir, 'claude-args.js'));
    const AgentScheduler = require(path.join(srcDir, 'agent-scheduler.js'));

    const specDir = path.resolve(__dirname, '../../../spec');
    const scheduler = new AgentScheduler({ specDir, spawnFn: () => {} });

    const sessionId = 'cccccccc-3333-4444-a555-666666666666';
    const prompt = 'unified test prompt';

    const directArgs = claudeArgs.buildClaudeArgs({
      prompt, sessionId, isNew: true, role: 'arch',
    });

    const schedulerArgs = scheduler._buildArgs('arch', sessionId, true, prompt);

    assert.deepStrictEqual(schedulerArgs, directArgs,
      'Scheduler and shared module should produce identical args');

    console.log('[PASS] Step 4: Both callers produce identical output');
  });
});
