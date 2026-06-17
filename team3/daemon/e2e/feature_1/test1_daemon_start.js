'use strict';

/**
 * Integration Test: Daemon process starts and outputs port
 * Checkpoint Step 1: 终端执行启动命令，daemon 进程启动成功，控制台输出监听端口
 * Checkpoint Step 2: .team3-project.json 中 init_daemon 字段记录进程 PID
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Feature 1 - Step 1 & 2: Daemon Start & PID', () => {
  let daemonProcess;
  let tmpDir;
  let projectJsonPath;

  afterEach(async () => {
    if (daemonProcess && !daemonProcess.killed) {
      daemonProcess.kill('SIGTERM');
      await new Promise(resolve => {
        daemonProcess.on('exit', resolve);
        setTimeout(resolve, 2000);
      });
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should start daemon process and output listening port', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team3-e2e-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    fs.writeFileSync(projectJsonPath, JSON.stringify({ name: 'e2e-test' }));

    const port = 14100 + Math.floor(Math.random() * 1000);

    const output = await new Promise((resolve, reject) => {
      let stdout = '';
      daemonProcess = spawn('node', ['src/daemon.js'], {
        cwd: path.resolve(__dirname, '../..'),
        env: {
          ...process.env,
          DAEMON_PORT: String(port),
          TEAM3_PROJECT_JSON: projectJsonPath,
          DAEMON_HEARTBEAT_INTERVAL: '1000',
        },
      });

      daemonProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        // Once we see the "Started" message, resolve
        if (stdout.includes('Started on port')) {
          resolve(stdout);
        }
      });

      daemonProcess.stderr.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      daemonProcess.on('error', reject);
      daemonProcess.on('exit', (code) => {
        if (!stdout.includes('Started on port')) {
          reject(new Error(`Daemon exited with code ${code}: ${stdout}`));
        }
      });

      // Timeout after 5s
      setTimeout(() => reject(new Error(`Daemon did not start within 5s. Output: ${stdout}`)), 5000);
    });

    // Step 1: Console output shows listening port
    assert.ok(output.includes(`Started on port ${port}`), `Expected port ${port} in output: ${output}`);
    assert.ok(output.includes('PID:'), 'Expected PID in output');

    // Step 2: .team3-project.json has init_daemon field with PID
    const projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
    assert.strictEqual(projectData.init_daemon, daemonProcess.pid);
    assert.ok(typeof projectData.init_daemon === 'number');
    assert.ok(projectData.init_daemon > 0);
  });
});
