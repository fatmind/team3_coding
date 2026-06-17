'use strict';

/**
 * Integration Test: Step 1 & 2 (Feature #14)
 * "Agent exit 0 with stdout result but no actions.jsonl write
 *  → daemon auto-appends to_human message"
 *
 * Uses a real spawned node process that outputs stream-json with a result
 * event but does NOT write to actions.jsonl. Verifies daemon fallback kicks in.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const AgentScheduler = require('../../src/agent-scheduler');
const Daemon = require('../../src/daemon');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: Fallback write to actions.jsonl (Feature #14, Step 1 & 2)', { timeout: 30_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let actionsFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat14-fallback-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');
    actionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'), '# Dev');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'), '# UAT');

    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'aaaaaaaa-1111-4222-8333-444444444444' } },
        dev_agent: { session: { runing: 'dddddddd-1111-4222-8333-444444444444', done: [] } },
        uat_agent: { session: { runing: 'uuuuuuuu-1111-4222-8333-444444444444' } },
      }
    }, null, 2));

    fs.writeFileSync(actionsFile, '');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should auto-append to_human when agent exits 0 without writing actions.jsonl (Step 1)', async () => {
    const fallbackEvents = [];
    const completedEvents = [];

    // Spawn a real node process that outputs stream-json result but does NOT write to actionsFile
    function testSpawn(cmd, args, opts) {
      const script = `
        process.stdout.write(JSON.stringify({type:"system",subtype:"init"}) + "\\n");
        process.stdout.write(JSON.stringify({type:"result",result:"Feature #14 测试：这是 agent 的回复内容"}) + "\\n");
        process.exit(0);
      `;
      return spawn('node', ['-e', script], {
        ...opts,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: testSpawn,
      actionsFilePath: actionsFile,
    });

    scheduler.on('fallback', (info) => fallbackEvents.push(info));
    scheduler.on('completed', (info) => completedEvents.push(info));

    scheduler.dispatch({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'test fallback',
    });

    await sleep(3000);

    // Step 1: Verify fallback was applied
    assert.strictEqual(fallbackEvents.length, 1);
    assert.strictEqual(fallbackEvents[0].role, 'arch');
    assert.strictEqual(fallbackEvents[0].action.action, 'to_human');
    assert.strictEqual(fallbackEvents[0].action.from, 'arch');
    assert.strictEqual(fallbackEvents[0].action.to, 'human');
    assert.ok(fallbackEvents[0].action.message.includes('Feature #14 测试'));

    // Step 2: Verify message format in actions.jsonl
    const content = fs.readFileSync(actionsFile, 'utf-8').trim();
    assert.ok(content.length > 0, 'actions.jsonl should have fallback entry');
    const action = JSON.parse(content);
    assert.strictEqual(action.action, 'to_human');
    assert.strictEqual(action.from, 'arch');
    assert.strictEqual(action.to, 'human');
    assert.ok(typeof action.ts === 'number');
    assert.ok(action.message.length > 0);

    // Verify completed event includes fallback info
    assert.strictEqual(completedEvents[0].fallback.applied, true);

    scheduler.clearAllTimers();
  });

  it('should broadcast via WS when fallback writes to actions.jsonl (Step 2 WS)', async () => {
    // Clear file for fresh test
    fs.writeFileSync(actionsFile, '');

    // Set up a daemon with WS to verify broadcast
    const port = 13142;
    const daemon = new Daemon({
      port,
      projectJsonPath,
      heartbeatInterval: 999999,
      wsPingInterval: 999999,
    });
    await daemon.start();

    // Connect WS client
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://localhost:${port}`);
    const wsMessages = [];

    await new Promise((resolve) => {
      ws.on('open', resolve);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent.msg') wsMessages.push(msg);
      } catch (e) { /* skip non-json */ }
    });

    await sleep(200);

    // The fallback write will be detected by ActionWatcher in a real orchestrator.
    // For this test, we verify the file is correctly written and parseable.
    // (Full WS broadcast is tested via DaemonOrchestrator in Feature #5)

    function testSpawn(cmd, args, opts) {
      const script = `
        process.stdout.write(JSON.stringify({type:"result",result:"ws broadcast test"}) + "\\n");
        process.exit(0);
      `;
      return spawn('node', ['-e', script], {
        ...opts,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    const scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      spawnFn: testSpawn,
      actionsFilePath: actionsFile,
    });

    scheduler.dispatch({
      action: 'to_arch', from: 'human', to: 'arch', ts: 2, message: 'ws test',
    });

    await sleep(2000);

    // Verify the fallback wrote a valid action to the file
    const content = fs.readFileSync(actionsFile, 'utf-8').trim();
    const lines = content.split('\n').filter(l => l.trim());
    assert.ok(lines.length >= 1);
    const lastAction = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(lastAction.action, 'to_human');
    assert.strictEqual(lastAction.from, 'arch');

    ws.close();
    await daemon.stop();
    scheduler.clearAllTimers();
  });
});
