'use strict';

/**
 * E2E Test: Feature #6 — reread rewrite protocol
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Verifies reread rewriting through the full DaemonOrchestrator pipeline:
 *   - to=dev / to=arch keep reread unchanged
 *   - to=uat filters feature_list/progress files
 *   - to=human strips reread before scheduler skip
 *
 * Also verifies Step 1: to=human → reread stripped (tested via to_human actions
 * that go to AgentScheduler but _resolveTarget returns null, so no spawn).
 *
 * Verification method: capture the 'spawn' event's `prompt` field from
 * DaemonOrchestrator. For to=human (no spawn), verify via the 'skip' event.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const DaemonOrchestrator = require('../../src/daemon-orchestrator');

const PORT = 13602;

describe('E2E: reread rewrite via REAL claude (Feature #6)', { timeout: 300_000 }, () => {
  let tmpDir;
  let actionsFile;
  let projectJsonPath;
  let specDir;
  let orchestrator;

  function realSpawn(cmd, args, opts) {
    return spawn(cmd, args, { ...opts, cwd: tmpDir });
  }

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature6-test2-real-'));
    actionsFile = path.join(tmpDir, 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'),
      '# Arch\n你是测试用 arch agent。收到消息后只回复 "确认收到"。');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'),
      '# Dev\n你是测试用 dev agent。收到消息后只回复 "确认收到"。');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'),
      '# UAT\n你是测试用 uat agent。收到消息后只回复 "确认收到"。');

    fs.writeFileSync(actionsFile, '');

    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: null } },
        dev_agent: { session: { runing: null, done: [] } },
        uat_agent: { session: { runing: null } },
      }
    }, null, 2));


    orchestrator = new DaemonOrchestrator({
      port: PORT,
      projectJsonPath,
      actionsFilePath: actionsFile,
      specDir,
      spawnFn: realSpawn,
      heartbeatInterval: 60000,
      wsPingInterval: 60000,
    });

    await orchestrator.start();
  });

  after(async () => {
    if (orchestrator) await orchestrator.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('to=dev → reread preserved unchanged', async () => {
    const spawns = [];
    const completed = [];
    orchestrator.on('spawn', (d) => spawns.push(d));
    orchestrator.on('completed', (d) => completed.push(d));

    const msg = '请实现 Feature #6 [reread: spec/module_3_feature_list.json]';
    const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 2000, message: msg };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');

    await waitFor(() => completed.length >= 1, 90_000);

    assert.ok(spawns.length >= 1, 'spawn event should have fired');
    const prompt = spawns[0].prompt;
    // reread preserved for dev
    assert.ok(prompt.includes('[reread: spec/module_3_feature_list.json]'),
      'reread should be preserved for dev');
    console.log('[PASS] to=dev → reread preserved unchanged');
    orchestrator.removeAllListeners('completed');
    orchestrator.removeAllListeners('spawn');
  });

  it('to=uat → reread filtered', async () => {
    const spawns = [];
    const completed = [];
    orchestrator.on('spawn', (d) => spawns.push(d));
    orchestrator.on('completed', (d) => completed.push(d));

    const msg = '请验证 module_3 [reread: spec/module_3.md, spec/module_3_feature_list.json]';
    const action = { action: 'uat_check', from: 'arch', to: 'uat', ts: 2001, message: msg };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');

    await waitFor(() => completed.length >= 1, 90_000);

    assert.ok(spawns.length >= 1, 'spawn event should have fired');
    const prompt = spawns[0].prompt;
    // feature_list filtered, module_3.md kept
    assert.ok(!prompt.includes('feature_list'), 'feature_list filtered for uat');
    assert.ok(prompt.includes('[reread: spec/module_3.md]'), 'module_3.md kept');
    console.log('[PASS] to=uat → reread filtered');
    orchestrator.removeAllListeners('completed');
    orchestrator.removeAllListeners('spawn');
  });

  it('to=arch → reread unchanged', async () => {
    const spawns = [];
    const completed = [];
    orchestrator.on('spawn', (d) => spawns.push(d));
    orchestrator.on('completed', (d) => completed.push(d));

    const msg = '交付完成 [reread: spec/module_3_progress.txt]';
    const action = { action: 'to_arch', from: 'dev', to: 'arch', ts: 2002, message: msg };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');

    await waitFor(() => completed.length >= 1, 90_000);

    assert.ok(spawns.length >= 1, 'spawn event should have fired');
    const prompt = spawns[0].prompt;
    assert.equal(prompt, msg, 'message to arch should be unchanged');

    console.log('[PASS] to=arch → reread unchanged');
    orchestrator.removeAllListeners('completed');
    orchestrator.removeAllListeners('spawn');
  });

  it('Step 1: to=human → reread stripped (verified via skip event)', async () => {
    // to=human messages don't get routed to an agent (AgentScheduler._resolveTarget returns null)
    // We verify by listening for the 'skip' event and checking the rewritten message
    const skips = [];
    orchestrator.on('skip', (d) => skips.push(d));

    const msg = '验收通过 [reread: spec/module_1.md, spec/module_1_feature_list.json]';
    const action = { action: 'to_human', from: 'arch', to: 'human', ts: 2003, message: msg };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');

    await waitFor(() => skips.length >= 1, 5000);

    // The skipped action should have rewritten message (no reread)
    assert.ok(!skips[0].action.message.includes('[reread:'),
      'to_human message should have reread stripped');
    assert.equal(skips[0].action.message, '验收通过',
      'reread should be completely removed');

    console.log('[PASS] Step 1: to=human → reread stripped');
    orchestrator.removeAllListeners('skip');
  });
});

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) resolve();
      else if (Date.now() - start > timeoutMs) reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      else setTimeout(check, 100);
    };
    check();
  });
}
