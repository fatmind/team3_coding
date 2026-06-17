'use strict';

/**
 * Integration Test: Step 3 & 4 (Feature #14)
 * Step 3: Agent exit 0 and already wrote to actions.jsonl → no duplicate append
 * Step 4: stdout empty or no result event → no append, no error
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const AgentScheduler = require('../../src/agent-scheduler');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('E2E: No fallback when not needed (Feature #14, Step 3 & 4)', { timeout: 30_000 }, () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let actionsFile;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-feat14-nofallback-'));
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

  it('should NOT append when agent already wrote to actions.jsonl (Step 3)', async () => {
    // Use actionsFile path that the spawned process can write to
    const escapedPath = actionsFile.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    function testSpawn(cmd, args, opts) {
      // This process writes to actions.jsonl AND outputs a result in stdout
      const script = `
        const fs = require('fs');
        const action = {"action":"to_human","from":"dev","to":"human","ts":${Math.floor(Date.now()/1000)},"message":"agent 正常写入"};
        fs.appendFileSync('${escapedPath}', JSON.stringify(action) + "\\n");
        process.stdout.write(JSON.stringify({type:"result",result:"agent also replied in stdout"}) + "\\n");
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

    const fallbackEvents = [];
    scheduler.on('fallback', (info) => fallbackEvents.push(info));

    scheduler.dispatch({
      action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'implement feature',
    });

    await sleep(3000);

    // Fallback should NOT have been applied
    assert.strictEqual(fallbackEvents.length, 0);

    // File should only have the agent's own write (1 line)
    const content = fs.readFileSync(actionsFile, 'utf-8').trim();
    const lines = content.split('\n').filter(l => l.trim());
    assert.strictEqual(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.strictEqual(parsed.message, 'agent 正常写入');

    scheduler.clearAllTimers();
  });

  it('should NOT append when stdout is empty (Step 4)', async () => {
    // Clear file
    fs.writeFileSync(actionsFile, '');

    function testSpawn(cmd, args, opts) {
      // Process exits 0 with no stdout at all
      const script = 'process.exit(0);';
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

    const fallbackEvents = [];
    scheduler.on('fallback', (info) => fallbackEvents.push(info));

    scheduler.dispatch({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'empty stdout',
    });

    await sleep(2000);

    // No fallback
    assert.strictEqual(fallbackEvents.length, 0);

    // File should remain empty
    const content = fs.readFileSync(actionsFile, 'utf-8').trim();
    assert.strictEqual(content, '');

    scheduler.clearAllTimers();
  });

  it('should NOT append when stdout has no result event (Step 4)', async () => {
    // Clear file
    fs.writeFileSync(actionsFile, '');

    function testSpawn(cmd, args, opts) {
      // Process outputs non-result events only
      const script = `
        process.stdout.write(JSON.stringify({type:"system",subtype:"init"}) + "\\n");
        process.stdout.write(JSON.stringify({type:"assistant",content:[{type:"text",text:"hello"}]}) + "\\n");
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

    const fallbackEvents = [];
    scheduler.on('fallback', (info) => fallbackEvents.push(info));

    let completed = false;
    scheduler.on('completed', (info) => {
      if (info.exitCode === 0) completed = true;
    });

    scheduler.dispatch({
      action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'no result event',
    });

    await sleep(2000);

    // No fallback
    assert.strictEqual(fallbackEvents.length, 0);
    // But agent completed normally
    assert.strictEqual(completed, true);
    // File should remain empty
    assert.strictEqual(fs.readFileSync(actionsFile, 'utf-8').trim(), '');
    // Queue should be idle for subsequent messages
    assert.strictEqual(scheduler.isAgentBusy('arch'), false);

    scheduler.clearAllTimers();
  });
});
