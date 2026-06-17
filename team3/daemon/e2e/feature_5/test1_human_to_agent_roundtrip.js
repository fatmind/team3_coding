'use strict';

/**
 * E2E Test: Feature #5 — Full human→agent→ws roundtrip
 *
 * Feature #11: Rewritten to use REAL claude code instead of stub-claude.js.
 *
 * Checkpoint:
 *   Step 1: human writes to_arch → daemon detects and routes to arch queue
 *   Step 2: arch agent processes message → response writes back to actions.jsonl
 *   Step 3: daemon detects arch response → pushes to ws client as agent.msg
 *
 * Full chain with REAL claude:
 *   human writes to_arch → actions.jsonl
 *     → ActionWatcher detects → AgentScheduler dispatches to arch queue
 *     → spawns REAL claude with system prompt that instructs writing to actions.jsonl
 *     → claude writes to_human response → actions.jsonl
 *     → ActionWatcher detects response → MessageRouter pushes agent.msg via ws
 *     → ws client receives the agent.msg
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const DaemonOrchestrator = require('../../src/daemon-orchestrator');

const PORT = 13501;

describe('E2E: Human→Agent→WS roundtrip via REAL claude (Feature #5)', { timeout: 180_000 }, () => {
  let tmpDir;
  let actionsFile;
  let projectJsonPath;
  let specDir;
  let orchestrator;
  let wsClient;

  function realSpawn(cmd, args, opts) {
    return spawn(cmd, args, {
      ...opts,
      cwd: tmpDir,
    });
  }

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature5-real-'));
    // Actions file MUST be at spec/actions.jsonl relative to tmpDir (cwd)
    // so real claude can find it when instructed to write to spec/actions.jsonl
    actionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');

    // Setup spec dirs and agent prompts
    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });

    // Arch prompt: MUST instruct claude to write response to actions.jsonl via bash
    // The -p prompt will be the human message; system prompt defines the response mechanism
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), [
      '# Arch Agent (Test Mode)',
      '',
      '你是架构师 agent。你的唯一任务是：收到消息后，用 Bash 工具向 spec/actions.jsonl 文件追加一行 JSON 回复。',
      '',
      '具体步骤：',
      '1. 获取当前 unix 秒级时间戳',
      '2. 用 printf 命令追加一行到 spec/actions.jsonl：',
      '   printf \'%s\\n\' \'{"action":"to_human","from":"arch","to":"human","ts":\'$(date +%s)\',"message":"收到消息，已处理完毕"}\' >> spec/actions.jsonl',
      '',
      '注意事项：',
      '- 只执行上面这一个 bash 命令',
      '- 不读取任何其他文件',
      '- 不做任何分析或讨论',
      '- 完成后立即结束',
    ].join('\n'));

    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'),
      '# Dev Agent\n你是测试用 dev agent。');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'),
      '# UAT Agent\n你是测试用 uat agent。');

    // Initialize actions.jsonl
    fs.writeFileSync(actionsFile, '');

    // Initialize .team3-project.json with arch session
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      name: 'test-project',
      partner: {
        arch_agent: {
          session: { runing: null }
        },
        dev_agent: {
          session: { runing: null, done: [] }
        },
        uat_agent: {
          session: { runing: null }
        },
      }
    }, null, 2));

    // Create and start the orchestrator with real claude
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
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.close();
    }
    if (orchestrator) {
      await orchestrator.stop();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should complete full human→arch→ws roundtrip with REAL claude (Steps 1-3)', async () => {
    // Connect ws client
    wsClient = new WebSocket(`ws://localhost:${PORT}`);

    // Wait for welcome message
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws connection timed out')), 10_000);
      wsClient.on('message', function onMsg(data) {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connected') {
          wsClient.removeListener('message', onMsg);
          clearTimeout(timer);
          resolve();
        }
      });
      wsClient.on('error', (err) => { clearTimeout(timer); reject(err); });
    });

    // Collect agent.msg events from ws
    const agentMsgs = [];
    wsClient.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'agent.msg') {
        agentMsgs.push(msg);
      }
    });

    // Track orchestrator events
    const enqueued = [];
    const completed = [];
    orchestrator.on('enqueued', (data) => enqueued.push(data));
    orchestrator.on('completed', (data) => completed.push(data));

    // === STEP 1: Human writes to_arch message ===
    // The message must explicitly instruct claude to write to actions.jsonl
    // (same pattern as Feature #2's getArchInitPrompt which works with real claude)
    const humanMsg = {
      action: 'to_arch',
      from: 'human',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: '请在 spec/actions.jsonl 文件末尾追加一行 JSON：{"action":"to_human","from":"arch","to":"human","ts":' + Math.floor(Date.now() / 1000) + ',"message":"收到消息，已处理完毕"}。只做这一件事，完成后退出。',
    };
    fs.appendFileSync(actionsFile, JSON.stringify(humanMsg) + '\n');

    // Wait for AgentScheduler to enqueue
    await waitFor(() => enqueued.length >= 1, 10_000);

    // === STEP 1 verification: daemon detected and routed to arch queue ===
    assert.equal(enqueued[0].role, 'arch', 'Should be routed to arch');
    console.log('[PASS] Step 1: Human to_arch detected and routed to arch queue');

    // Wait for real claude to complete (it should write response to actions.jsonl)
    await waitFor(() => completed.length >= 1, 90_000);

    // === STEP 2 verification: arch responded (real claude wrote back to actions.jsonl) ===
    assert.equal(completed[0].role, 'arch', 'arch should have completed');
    assert.equal(completed[0].exitCode, 0, 'real claude should exit 0');

    // Read actions.jsonl to verify response was written by real claude
    const content = fs.readFileSync(actionsFile, 'utf-8').trim();
    const lines = content.split('\n').filter(l => l.trim());
    assert.ok(lines.length >= 2, `Should have at least 2 lines (human msg + arch response), got ${lines.length}`);

    // Find the arch response (any line with from=arch)
    const archLine = lines.find(l => {
      try {
        const obj = JSON.parse(l);
        return obj.from === 'arch';
      } catch { return false; }
    });
    assert.ok(archLine, 'Should find an arch response in actions.jsonl');

    const archResponse = JSON.parse(archLine);
    assert.equal(archResponse.from, 'arch', 'Response should be from arch');
    assert.ok(archResponse.message, 'Response should have a message');

    console.log('[PASS] Step 2: REAL claude processed message and responded to actions.jsonl');
    console.log('  Arch response:', archResponse.message);

    // === STEP 3 verification: ws client received agent.msg ===
    // Wait for ws push (ActionWatcher detects arch response → MessageRouter broadcasts)
    await waitFor(() => agentMsgs.length >= 1, 15_000);

    assert.ok(agentMsgs.length >= 1, 'ws client should receive at least 1 agent.msg');

    // Find the arch response in ws messages
    const archWsMsg = agentMsgs.find(m => {
      try {
        const payload = JSON.parse(m.payload);
        return payload.from === 'arch';
      } catch { return false; }
    });
    assert.ok(archWsMsg, 'ws client should have received arch response as agent.msg');
    assert.equal(archWsMsg.type, 'agent.msg');

    console.log('[PASS] Step 3: ws client received arch response as agent.msg');

    // Verify human message was NOT pushed via ws (from=human should be filtered)
    const humanWsMsgs = agentMsgs.filter(m => {
      try {
        const payload = JSON.parse(m.payload);
        return payload.from === 'human';
      } catch { return false; }
    });
    assert.equal(humanWsMsgs.length, 0, 'Human messages should NOT appear in ws');

    console.log('[PASS] Bonus: human message correctly filtered from ws push');
  });
});

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}
