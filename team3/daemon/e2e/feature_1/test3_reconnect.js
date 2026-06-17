'use strict';

/**
 * Integration Test: WebSocket client disconnect and reconnect
 * Checkpoint Step 5: WebSocket 客户端断开后重新连接，自动恢复通信
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Daemon = require('../../src/daemon');

describe('Feature 1 - Step 5: Client Reconnection', () => {
  let daemon;
  let tmpDir;
  let projectJsonPath;
  let port;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team3-e2e-reconnect-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    fs.writeFileSync(projectJsonPath, JSON.stringify({ name: 'e2e-reconnect-test' }));

    port = 14300 + Math.floor(Math.random() * 1000);
    daemon = new Daemon({
      port,
      projectJsonPath,
      heartbeatInterval: 5000,
      wsPingInterval: 5000,
    });

    await daemon.start();
  });

  after(async () => {
    if (daemon && daemon.isRunning) {
      await daemon.stop();
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Step 5: client can disconnect and reconnect successfully', async () => {
    // --- First connection ---
    const ws1 = new WebSocket(`ws://localhost:${port}`);

    const welcome1 = await new Promise((resolve, reject) => {
      ws1.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws1.on('error', reject);
      setTimeout(() => reject(new Error('Connection 1 timeout')), 3000);
    });

    assert.strictEqual(welcome1.type, 'connected');
    const clientId1 = welcome1.clientId;
    assert.ok(clientId1);
    assert.strictEqual(daemon.clientCount, 1);

    // Send a message to verify communication
    ws1.send(JSON.stringify({ type: 'ping' }));
    const pong1 = await new Promise((resolve, reject) => {
      ws1.on('message', (data) => resolve(JSON.parse(data.toString())));
      setTimeout(() => reject(new Error('Pong 1 timeout')), 3000);
    });
    assert.strictEqual(pong1.type, 'pong');

    // --- Disconnect ---
    ws1.close();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.strictEqual(daemon.clientCount, 0);

    // --- Reconnect ---
    const ws2 = new WebSocket(`ws://localhost:${port}`);

    const welcome2 = await new Promise((resolve, reject) => {
      ws2.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws2.on('error', reject);
      setTimeout(() => reject(new Error('Connection 2 timeout')), 3000);
    });

    assert.strictEqual(welcome2.type, 'connected');
    const clientId2 = welcome2.clientId;
    assert.ok(clientId2);
    assert.strictEqual(daemon.clientCount, 1);

    // New connection gets a new clientId
    assert.notStrictEqual(clientId1, clientId2);

    // Verify communication still works after reconnect
    ws2.send(JSON.stringify({ type: 'ping' }));
    const pong2 = await new Promise((resolve, reject) => {
      ws2.on('message', (data) => resolve(JSON.parse(data.toString())));
      setTimeout(() => reject(new Error('Pong 2 timeout')), 3000);
    });
    assert.strictEqual(pong2.type, 'pong');

    ws2.close();
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('Step 5: multiple clients can connect simultaneously', async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    const ws2 = new WebSocket(`ws://localhost:${port}`);

    // Wait for both to connect
    const [welcome1, welcome2] = await Promise.all([
      new Promise((resolve, reject) => {
        ws1.on('message', (data) => resolve(JSON.parse(data.toString())));
        ws1.on('error', reject);
        setTimeout(() => reject(new Error('Client 1 timeout')), 3000);
      }),
      new Promise((resolve, reject) => {
        ws2.on('message', (data) => resolve(JSON.parse(data.toString())));
        ws2.on('error', reject);
        setTimeout(() => reject(new Error('Client 2 timeout')), 3000);
      }),
    ]);

    assert.strictEqual(welcome1.type, 'connected');
    assert.strictEqual(welcome2.type, 'connected');
    assert.strictEqual(daemon.clientCount, 2);
    assert.notStrictEqual(welcome1.clientId, welcome2.clientId);

    // Disconnect one, other stays
    ws1.close();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.strictEqual(daemon.clientCount, 1);

    // Second client still works
    ws2.send(JSON.stringify({ type: 'ping' }));
    const pong = await new Promise((resolve, reject) => {
      ws2.on('message', (data) => resolve(JSON.parse(data.toString())));
      setTimeout(() => reject(new Error('Pong timeout')), 3000);
    });
    assert.strictEqual(pong.type, 'pong');

    ws2.close();
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('Step 5: reconnection after abrupt disconnect (terminate)', async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}`);

    await new Promise((resolve, reject) => {
      ws1.on('message', () => resolve());
      ws1.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    assert.strictEqual(daemon.clientCount, 1);

    // Abrupt disconnect (simulate network failure)
    ws1.terminate();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.strictEqual(daemon.clientCount, 0);

    // Reconnect after abrupt disconnect
    const ws2 = new WebSocket(`ws://localhost:${port}`);

    const welcome = await new Promise((resolve, reject) => {
      ws2.on('message', (data) => resolve(JSON.parse(data.toString())));
      ws2.on('error', reject);
      setTimeout(() => reject(new Error('Reconnect timeout')), 3000);
    });

    assert.strictEqual(welcome.type, 'connected');
    assert.strictEqual(daemon.clientCount, 1);

    // Communication works
    ws2.send(JSON.stringify({ type: 'ping' }));
    const pong = await new Promise((resolve, reject) => {
      ws2.on('message', (data) => resolve(JSON.parse(data.toString())));
      setTimeout(() => reject(new Error('Pong timeout')), 3000);
    });
    assert.strictEqual(pong.type, 'pong');

    ws2.close();
    await new Promise(resolve => setTimeout(resolve, 100));
  });
});
