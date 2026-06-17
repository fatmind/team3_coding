'use strict';

/**
 * E2E Test: Feature #6 — Checkpoint Steps 1-3 (reread protocol)
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Verifies the message rewriting through the full DaemonOrchestrator pipeline:
 *   Step 1: to=human → reread stripped entirely (covered in test2)
 *   Step 2: to=uat → feature_list and progress files filtered from reread
 *   Step 3: to=arch or to=dev → reread preserved unchanged
 *
 * Verification method: capture the 'spawn' event's `prompt` field from
 * DaemonOrchestrator, which contains the rewritten message passed to claude.
 * This replaces the old stub-claude log approach.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const DaemonOrchestrator = require('../../src/daemon-orchestrator');

const PORT = 13601;

describe('E2E: reread protocol rewriting via REAL claude (Feature #6 Steps 1-3)', { timeout: 300_000 }, () => {
  let tmpDir;
  let actionsFile;
  let projectJsonPath;
  let specDir;
  let modulesProgressPath;
  let orchestrator;

  function realSpawn(cmd, args, opts) {
    return spawn(cmd, args, { ...opts, cwd: tmpDir });
  }

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature6-test1-real-'));
    actionsFile = path.join(tmpDir, 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');
    modulesProgressPath = path.join(tmpDir, 'modules_progress.json');

    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'),
      '# Arch\n你是测试用 arch agent。收到消息后只回复 "确认收到"，不做任何其他操作。');
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

    // No in_progress module for reread tests (cwd tests are separate)
    fs.writeFileSync(modulesProgressPath, JSON.stringify({
      modules: [{ id: 'module_3', status: 'done', cwd: 'daemon/' }]
    }));

    orchestrator = new DaemonOrchestrator({
      port: PORT,
      projectJsonPath,
      actionsFilePath: actionsFile,
      specDir,
      spawnFn: realSpawn,
      heartbeatInterval: 60000,
      wsPingInterval: 60000,
      modulesProgressPath,
    });

    await orchestrator.start();
  });

  after(async () => {
    if (orchestrator) await orchestrator.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 3: to=arch → reread preserved unchanged', async () => {
    const spawns = [];
    const completed = [];
    orchestrator.on('spawn', (d) => spawns.push(d));
    orchestrator.on('completed', (d) => completed.push(d));

    const msg = '交付完成 [reread: spec/module_1.md, spec/module_1_feature_list.json]';
    const action = { action: 'to_arch', from: 'dev', to: 'arch', ts: 1000, message: msg };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');

    await waitFor(() => completed.length >= 1, 90_000);

    assert.ok(spawns.length >= 1, 'spawn event should have fired');
    const prompt = spawns[0].prompt;
    assert.ok(prompt.includes('[reread: spec/module_1.md, spec/module_1_feature_list.json]'),
      'reread should be preserved for arch');
    assert.equal(prompt, msg, 'Message to arch should be unchanged');

    console.log('[PASS] Step 3: to=arch → reread preserved unchanged');
    orchestrator.removeAllListeners('completed');
    orchestrator.removeAllListeners('spawn');
  });

  it('Step 3: to=dev → reread preserved unchanged', async () => {
    const spawns = [];
    const completed = [];
    orchestrator.on('spawn', (d) => spawns.push(d));
    orchestrator.on('completed', (d) => completed.push(d));

    const msg = '请实现 Feature #4 [reread: spec/module_3_feature_list.json, spec/module_3_progress.txt]';
    const action = { action: 'dev_do', from: 'arch', to: 'dev', ts: 1001, message: msg };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');

    await waitFor(() => completed.length >= 1, 90_000);

    assert.ok(spawns.length >= 1, 'spawn event should have fired');
    const prompt = spawns[0].prompt;
    assert.ok(prompt.includes('[reread: spec/module_3_feature_list.json, spec/module_3_progress.txt]'),
      'reread should be preserved for dev');

    console.log('[PASS] Step 3: to=dev → reread preserved unchanged');
    orchestrator.removeAllListeners('completed');
    orchestrator.removeAllListeners('spawn');
  });

  it('Step 2: to=uat → feature_list and progress filtered from reread', async () => {
    const spawns = [];
    const completed = [];
    orchestrator.on('spawn', (d) => spawns.push(d));
    orchestrator.on('completed', (d) => completed.push(d));

    const msg = '请验证 [reread: spec/module_1.md, spec/module_1_feature_list.json, spec/module_1_progress.txt]';
    const action = { action: 'uat_check', from: 'arch', to: 'uat', ts: 1002, message: msg };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');

    await waitFor(() => completed.length >= 1, 90_000);

    assert.ok(spawns.length >= 1, 'spawn event should have fired');
    const prompt = spawns[0].prompt;
    assert.ok(!prompt.includes('feature_list'), 'feature_list should be filtered for uat');
    assert.ok(!prompt.includes('progress.txt'), 'progress.txt should be filtered for uat');
    assert.ok(prompt.includes('[reread: spec/module_1.md]'), 'non-filtered files should be preserved');

    console.log('[PASS] Step 2: to=uat → feature_list and progress filtered from reread');
    orchestrator.removeAllListeners('completed');
    orchestrator.removeAllListeners('spawn');
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
