'use strict';

/**
 * Integration Test: WebSocket connection and ping/pong heartbeat
 * Checkpoint Step 3: WebSocket 客户端连接成功，ping/pong 心跳正常
 * Checkpoint Step 4: daemon 周期性更新 .team3-project.json 的 daemon_heart 字段
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Daemon = require('../../src/daemon');

describe('Feature 1 - Step 3 & 4: WebSocket & Heartbeat', () => {
  let daemon;
  let tmpDir;
  let projectJsonPath;
  let port;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team3-e2e-ws-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    fs.writeFileSync(projectJsonPath, JSON.stringify({ name: 'e2e-ws-test' }));

    port = 14200 + Math.floor(Math.random() * 1000);
    daemon = new Daemon({
      port,
      projectJsonPath,
      heartbeatInterval: 500, // fast for testing
      wsPingInterval: 1000,
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

  it('Step 3: WebSocket client connects and receives welcome message', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    const message = await new Promise((resolve, reject) => {
      ws.on('open', () => {});
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    assert.strictEqual(message.type, 'connected');
    assert.ok(message.clientId);
    assert.strictEqual(message.daemonPid, process.pid);
    assert.ok(message.timestamp);

    ws.close();
    // Wait for close to process
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('Step 3: ping/pong heartbeat works (application-level)', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    // Wait for connection and consume welcome
    await new Promise((resolve, reject) => {
      ws.on('open', () => {});
      ws.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connected') resolve();
        else reject(new Error(`Expected welcome, got: ${data}`));
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    // Send application-level ping
    ws.send(JSON.stringify({ type: 'ping' }));

    const pong = await new Promise((resolve, reject) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
      setTimeout(() => reject(new Error('Pong timeout')), 3000);
    });

    assert.strictEqual(pong.type, 'pong');
    assert.ok(pong.timestamp);

    ws.close();
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('Step 3: WebSocket protocol-level ping/pong works', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 3000);
    });

    // Test protocol-level ping/pong
    const gotPong = await new Promise((resolve, reject) => {
      ws.on('pong', () => resolve(true));
      ws.ping();
      setTimeout(() => reject(new Error('Protocol pong timeout')), 3000);
    });

    assert.strictEqual(gotPong, true);

    ws.close();
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('Step 4: daemon periodically updates daemon_heart', async () => {
    // Read initial heartbeat
    const data1 = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    const heart1 = data1.daemon_heart;
    assert.ok(heart1, 'daemon_heart should be set');

    // Wait for heartbeat interval (500ms configured)
    await new Promise(resolve => setTimeout(resolve, 700));

    // Read updated heartbeat
    const data2 = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    const heart2 = data2.daemon_heart;
    assert.ok(heart2, 'daemon_heart should still be set');

    // Heartbeat should have been updated (different timestamp)
    const t1 = new Date(heart1).getTime();
    const t2 = new Date(heart2).getTime();
    assert.ok(t2 > t1, `Heartbeat should update: ${heart1} -> ${heart2}`);
  });
});
