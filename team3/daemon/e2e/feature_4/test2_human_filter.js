'use strict';

/**
 * E2E Test: Feature #4 - Checkpoint Step 3
 *
 * Step 3: Human (from=human) writes to actions.jsonl,
 *         daemon does NOT push via ws (avoids duplicate display in web).
 *
 * This test uses real Daemon, real ActionWatcher, real MessageRouter,
 * and real WebSocket client — no mocks on the system under test.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');

const Daemon = require('../../src/daemon');
const ActionWatcher = require('../../src/action-watcher');
const MessageRouter = require('../../src/message-router');

describe('E2E: Human message NOT pushed via ws (Checkpoint Step 3)', () => {
  let tmpDir;
  let actionsFile;
  let projectJsonPath;
  let daemon;
  let watcher;
  let router;
  let wsClient;
  const PORT = 13402;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature4-test2-'));
    actionsFile = path.join(tmpDir, 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');

    fs.writeFileSync(actionsFile, '');
    fs.writeFileSync(projectJsonPath, JSON.stringify({ name: 'test' }));

    daemon = new Daemon({ port: PORT, projectJsonPath, heartbeatInterval: 60000, wsPingInterval: 60000 });
    await daemon.start();

    watcher = new ActionWatcher(actionsFile);
    watcher.start();

    router = new MessageRouter({ actionWatcher: watcher, daemon });
    router.start();
  });

  after(async () => {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.close();
    }
    router.stop();
    await watcher.stop();
    await daemon.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should NOT push via ws when human writes to actions.jsonl, but SHOULD push when agent writes', async () => {
    // Connect ws client
    wsClient = new WebSocket(`ws://localhost:${PORT}`);

    // Wait for welcome
    await new Promise((resolve) => {
      wsClient.on('message', function onMsg(data) {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connected') {
          wsClient.removeListener('message', onMsg);
          resolve();
        }
      });
    });

    // Collect all agent.msg events
    const agentMsgs = [];
    wsClient.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'agent.msg') {
        agentMsgs.push(msg);
      }
    });

    // 1) Human writes a message — should NOT trigger agent.msg
    const humanAction = {
      action: 'to_arch',
      from: 'human',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: 'Please implement feature X',
    };
    fs.appendFileSync(actionsFile, JSON.stringify(humanAction) + '\n');

    // Wait for ActionWatcher to detect the change
    await new Promise(resolve => setTimeout(resolve, 600));

    // Verify no agent.msg was received
    assert.equal(agentMsgs.length, 0, 'Human message should NOT be pushed via ws');
    console.log('[PASS] Human message written → no ws push (0 agent.msg events)');

    // 2) Then an agent writes — should trigger agent.msg
    const agentAction = {
      action: 'to_human',
      from: 'arch',
      to: 'human',
      ts: Math.floor(Date.now() / 1000),
      message: 'I will do feature X',
    };
    const agentRawLine = JSON.stringify(agentAction);
    fs.appendFileSync(actionsFile, agentRawLine + '\n');

    // Wait for ws push
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (agentMsgs.length > 0) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      // Failsafe timeout
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    // Verify agent message was received
    assert.equal(agentMsgs.length, 1, 'Agent message should be pushed via ws');
    assert.equal(agentMsgs[0].type, 'agent.msg');
    assert.equal(agentMsgs[0].payload, agentRawLine);

    console.log('[PASS] Agent message written after human → only agent msg pushed (1 event), human msg filtered out');
  });

  it('should filter multiple human messages in a mixed sequence', async () => {
    const agentMsgs = [];
    // Clear old listeners and set up fresh
    wsClient.removeAllListeners('message');
    wsClient.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'agent.msg') {
        agentMsgs.push(msg);
      }
    });

    // Write a batch: human, human, agent, human, agent
    const lines = [
      { action: 'to_arch', from: 'human', to: 'arch', ts: 100, message: 'h1' },
      { action: 'dev_do', from: 'human', to: 'dev', ts: 101, message: 'h2' },
      { action: 'to_human', from: 'dev', to: 'human', ts: 102, message: 'a1' },
      { action: 'to_arch', from: 'human', to: 'arch', ts: 103, message: 'h3' },
      { action: 'to_human', from: 'uat', to: 'human', ts: 104, message: 'a2' },
    ];

    const batch = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
    fs.appendFileSync(actionsFile, batch);

    // Wait for processing
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (agentMsgs.length >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    // Only 2 agent messages should have been pushed (from dev and uat)
    assert.equal(agentMsgs.length, 2, 'Only 2 agent msgs out of 5 lines');

    const payloads = agentMsgs.map(m => JSON.parse(m.payload));
    assert.equal(payloads[0].from, 'dev');
    assert.equal(payloads[0].message, 'a1');
    assert.equal(payloads[1].from, 'uat');
    assert.equal(payloads[1].message, 'a2');

    console.log('[PASS] Mixed sequence: 3 human messages filtered, 2 agent messages pushed');
  });
});
