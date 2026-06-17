'use strict';

/**
 * E2E Test: Feature #4 - Checkpoint Step 1 & 2
 *
 * Step 1: Agent (e.g. arch) writes to actions.jsonl a to_human message,
 *         daemon detects it and pushes agent.msg event via ws.
 * Step 2: ws client receives payload as the raw jsonl line string.
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

describe('E2E: Agent→Human ws push (Checkpoint Steps 1 & 2)', () => {
  let tmpDir;
  let actionsFile;
  let projectJsonPath;
  let daemon;
  let watcher;
  let router;
  let wsClient;
  const PORT = 13401; // Unique port to avoid collision

  before(async () => {
    // Setup temp directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature4-test1-'));
    actionsFile = path.join(tmpDir, 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');

    // Initialize empty actions.jsonl
    fs.writeFileSync(actionsFile, '');
    // Initialize .team3-project.json
    fs.writeFileSync(projectJsonPath, JSON.stringify({ name: 'test' }));

    // Start real Daemon
    daemon = new Daemon({ port: PORT, projectJsonPath, heartbeatInterval: 60000, wsPingInterval: 60000 });
    await daemon.start();

    // Start real ActionWatcher
    watcher = new ActionWatcher(actionsFile);
    watcher.start();

    // Start real MessageRouter
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

  it('should push agent.msg via ws when arch writes to actions.jsonl (Step 1 & 2)', async () => {
    // Connect ws client
    wsClient = new WebSocket(`ws://localhost:${PORT}`);

    // Wait for connection + welcome message
    await new Promise((resolve) => {
      wsClient.on('message', function onMsg(data) {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connected') {
          wsClient.removeListener('message', onMsg);
          resolve();
        }
      });
    });

    // Prepare to listen for agent.msg event
    const receivedMessages = [];
    const msgPromise = new Promise((resolve) => {
      wsClient.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent.msg') {
          receivedMessages.push(msg);
          resolve();
        }
      });
    });

    // Simulate arch writing to actions.jsonl
    const archAction = {
      action: 'to_human',
      from: 'arch',
      to: 'human',
      ts: Math.floor(Date.now() / 1000),
      message: 'Feature #4 验收通过，开始下一个',
    };
    const rawLine = JSON.stringify(archAction);
    fs.appendFileSync(actionsFile, rawLine + '\n');

    // Wait for ws message (with timeout)
    const timer = setTimeout(() => {
      throw new Error('Timeout: did not receive agent.msg within 5s');
    }, 5000);

    await msgPromise;
    clearTimeout(timer);

    // Assertions
    assert.equal(receivedMessages.length, 1);
    const event = receivedMessages[0];

    // Step 1: daemon pushes agent.msg event
    assert.equal(event.type, 'agent.msg');

    // Step 2: payload is the raw jsonl line string
    assert.equal(typeof event.payload, 'string');
    assert.equal(event.payload, rawLine);

    // Verify payload parses back to the same object
    const parsedPayload = JSON.parse(event.payload);
    assert.deepStrictEqual(parsedPayload, archAction);

    console.log('[PASS] arch wrote to actions.jsonl → ws client received agent.msg with raw payload');
  });

  it('should push agent.msg for dev messages too', async () => {
    // Prepare to listen
    const receivedMessages = [];
    const msgPromise = new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent.msg') {
          receivedMessages.push(msg);
          wsClient.removeListener('message', handler);
          resolve();
        }
      };
      wsClient.on('message', handler);
    });

    // Dev writes to actions.jsonl
    const devAction = {
      action: 'to_arch',
      from: 'dev',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: 'Feature #4 已交付，checkpoint 全部通过',
    };
    const rawLine = JSON.stringify(devAction);
    fs.appendFileSync(actionsFile, rawLine + '\n');

    const timer = setTimeout(() => {
      throw new Error('Timeout: did not receive agent.msg for dev');
    }, 5000);

    await msgPromise;
    clearTimeout(timer);

    assert.equal(receivedMessages.length, 1);
    assert.equal(receivedMessages[0].type, 'agent.msg');
    assert.equal(receivedMessages[0].payload, rawLine);

    console.log('[PASS] dev message routed through ws as agent.msg');
  });

  it('should push agent.msg for uat messages', async () => {
    const receivedMessages = [];
    const msgPromise = new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent.msg') {
          receivedMessages.push(msg);
          wsClient.removeListener('message', handler);
          resolve();
        }
      };
      wsClient.on('message', handler);
    });

    const uatAction = {
      action: 'to_arch',
      from: 'uat',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: 'UAT report ready',
    };
    const rawLine = JSON.stringify(uatAction);
    fs.appendFileSync(actionsFile, rawLine + '\n');

    const timer = setTimeout(() => {
      throw new Error('Timeout: did not receive agent.msg for uat');
    }, 5000);

    await msgPromise;
    clearTimeout(timer);

    assert.equal(receivedMessages.length, 1);
    assert.equal(receivedMessages[0].type, 'agent.msg');
    assert.equal(receivedMessages[0].payload, rawLine);

    console.log('[PASS] uat message routed through ws as agent.msg');
  });
});
