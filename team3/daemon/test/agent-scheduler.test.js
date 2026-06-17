'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const AgentScheduler = require('../src/agent-scheduler');

describe('AgentScheduler', () => {
  let tmpDir;
  let projectJsonPath;
  let specDir;
  let modulesProgressPath;
  let scheduler;
  let spawnCalls;

  /**
   * Create a mock spawn that returns a fake child process.
   * The mock process will exit with code 0 after a short delay.
   */
  function createMockSpawn(exitCode = 0, delay = 10) {
    return (cmd, args, opts) => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { write: () => {}, end: () => {} };
      proc.pid = Math.floor(Math.random() * 99999);

      spawnCalls.push({ cmd, args, opts, proc });

      // Simulate async completion
      setTimeout(() => {
        proc.stdout.emit('data', Buffer.from('{"type":"result"}\n'));
        proc.emit('close', exitCode);
      }, delay);

      return proc;
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-test-'));
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    specDir = path.join(tmpDir, 'spec');
    modulesProgressPath = path.join(specDir, 'modules_progress.json');
    spawnCalls = [];

    // Create spec/agents directory
    fs.mkdirSync(path.join(specDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'agents', 'arch_prompt.md'), '# Arch');
    fs.writeFileSync(path.join(specDir, 'agents', 'dev_prompt.md'), '# Dev');
    fs.writeFileSync(path.join(specDir, 'agents', 'uat_prompt.md'), '# UAT');

    // Create project json with existing sessions
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } },
        dev_agent: { session: { runing: '1111-2222-3333-4444-555555555555', done: [] } },
        uat_agent: { session: { runing: 'ffff-0000-1111-2222-333333333333', done: [] } },
      }
    }, null, 2));

    const actionsFilePath = path.join(specDir, 'actions.jsonl');
    fs.writeFileSync(actionsFilePath, '');

    scheduler = new AgentScheduler({
      projectJsonPath,
      specDir,
      modulesProgressPath,
      actionsFilePath,
      spawnFn: createMockSpawn(),
      uuidFn: () => 'new-uuid-0000-0000-000000000001',
    });
  });

  function writeModulesProgress(modules) {
    fs.writeFileSync(modulesProgressPath, JSON.stringify({ modules }, null, 2));
  }

  afterEach(() => {
    scheduler.clearAllTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('_resolveTarget', () => {
    it('should route dev_do to dev', () => {
      const target = scheduler._resolveTarget({ action: 'dev_do', to: 'dev' });
      assert.strictEqual(target, 'dev');
    });

    it('should route dev_fix to dev', () => {
      const target = scheduler._resolveTarget({ action: 'dev_fix', to: 'dev' });
      assert.strictEqual(target, 'dev');
    });

    it('should route uat_check to uat', () => {
      const target = scheduler._resolveTarget({ action: 'uat_check', to: 'uat' });
      assert.strictEqual(target, 'uat');
    });

    it('should route uat_fix to uat', () => {
      const target = scheduler._resolveTarget({ action: 'uat_fix', to: 'uat' });
      assert.strictEqual(target, 'uat');
    });

    it('should route to_arch to arch', () => {
      const target = scheduler._resolveTarget({ action: 'to_arch', to: 'arch' });
      assert.strictEqual(target, 'arch');
    });

    it('should return null for to_human', () => {
      const target = scheduler._resolveTarget({ action: 'to_human', to: 'human' });
      assert.strictEqual(target, null);
    });

    it('should return null for note to human', () => {
      const target = scheduler._resolveTarget({ action: 'note', to: 'human' });
      assert.strictEqual(target, null);
    });
  });

  describe('_resolveSession', () => {
    it('dev_do should generate new sessionId and archive old', () => {
      const messages = [{ action: 'dev_do', message: 'new task' }];
      const result = scheduler._resolveSession('dev', messages);

      assert.strictEqual(result.sessionId, 'new-uuid-0000-0000-000000000001');
      assert.strictEqual(result.isNew, true);

      // Verify project json updated
      const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      assert.strictEqual(data.partner.dev_agent.session.runing, 'new-uuid-0000-0000-000000000001');
      assert.ok(data.partner.dev_agent.session.done.includes('1111-2222-3333-4444-555555555555'));
    });

    it('dev_fix should reuse current sessionId', () => {
      const messages = [{ action: 'dev_fix', message: 'fix bug' }];
      const result = scheduler._resolveSession('dev', messages);

      assert.strictEqual(result.sessionId, '1111-2222-3333-4444-555555555555');
      assert.strictEqual(result.isNew, false);
    });

    it('arch should reuse running session (resume)', () => {
      const messages = [{ action: 'to_arch', message: 'hello' }];
      const result = scheduler._resolveSession('arch', messages);

      assert.strictEqual(result.sessionId, 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      assert.strictEqual(result.isNew, false);
    });

    it('uat_check should generate new sessionId and archive old', () => {
      const messages = [{ action: 'uat_check', message: 'verify' }];
      const result = scheduler._resolveSession('uat', messages);

      assert.strictEqual(result.sessionId, 'new-uuid-0000-0000-000000000001');
      assert.strictEqual(result.isNew, true);

      const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      assert.strictEqual(data.partner.uat_agent.session.runing, 'new-uuid-0000-0000-000000000001');
      assert.ok(data.partner.uat_agent.session.done.includes('ffff-0000-1111-2222-333333333333'));
    });

    it('uat_design should generate new sessionId and archive old', () => {
      const messages = [{ action: 'uat_design', message: 'design stories' }];
      const result = scheduler._resolveSession('uat', messages);

      assert.strictEqual(result.sessionId, 'new-uuid-0000-0000-000000000001');
      assert.strictEqual(result.isNew, true);

      const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      assert.strictEqual(data.partner.uat_agent.session.runing, 'new-uuid-0000-0000-000000000001');
      assert.ok(data.partner.uat_agent.session.done.includes('ffff-0000-1111-2222-333333333333'));
    });

    it('uat_fix should reuse running session (resume)', () => {
      const messages = [{ action: 'uat_fix', message: 'recheck story' }];
      const result = scheduler._resolveSession('uat', messages);

      assert.strictEqual(result.sessionId, 'ffff-0000-1111-2222-333333333333');
      assert.strictEqual(result.isNew, false);
    });

    it('should create session if none exists', () => {
      // Remove arch session
      const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      data.partner.arch_agent.session.runing = null;
      fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2));

      const messages = [{ action: 'to_arch', message: 'hello' }];
      const result = scheduler._resolveSession('arch', messages);

      assert.strictEqual(result.sessionId, 'new-uuid-0000-0000-000000000001');
      assert.strictEqual(result.isNew, true);
    });

    it('arch should ignore legacy initialized=false and resume by action semantics', () => {
      const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      data.partner.arch_agent.session.initialized = false;
      fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2));

      const messages = [{ action: 'to_arch', message: 'hello' }];
      const result = scheduler._resolveSession('arch', messages);

      assert.strictEqual(result.sessionId, 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      assert.strictEqual(result.isNew, false);
    });

    it('uat_fix should resume even when initialized field is absent', () => {
      const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
      delete data.partner.uat_agent.session.initialized;
      fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2));

      const messages = [{ action: 'uat_fix', message: 'verify' }];
      const result = scheduler._resolveSession('uat', messages);

      assert.strictEqual(result.sessionId, 'ffff-0000-1111-2222-333333333333');
      assert.strictEqual(result.isNew, false);
    });

    describe('arch module-bound session (module_4 hardening)', () => {
      it('should bind bound_module on first in_progress without rotating', () => {
        writeModulesProgress([
          { id: 'module_1', status: 'in_progress' },
        ]);
        const messages = [{ action: 'to_arch', message: 'hello' }];
        const result = scheduler._resolveSession('arch', messages);

        assert.strictEqual(result.sessionId, 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        assert.strictEqual(result.isNew, false);
        const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        assert.strictEqual(data.partner.arch_agent.session.bound_module, 'module_1');
      });

      it('should rotate session when in_progress module changes', () => {
        writeModulesProgress([
          { id: 'module_2', status: 'in_progress' },
        ]);
        const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        data.partner.arch_agent.session.bound_module = 'module_1';
        fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2));

        const messages = [{ action: 'to_arch', message: 'next module' }];
        const result = scheduler._resolveSession('arch', messages);

        assert.strictEqual(result.sessionId, 'new-uuid-0000-0000-000000000001');
        assert.strictEqual(result.isNew, true);
        const updated = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        assert.strictEqual(updated.partner.arch_agent.session.bound_module, 'module_2');
        assert.ok(updated.partner.arch_agent.session.done.includes('aaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
      });

      it('should resume same session for same in_progress module', () => {
        writeModulesProgress([
          { id: 'module_1', status: 'in_progress' },
        ]);
        const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        data.partner.arch_agent.session.bound_module = 'module_1';
        fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2));

        const result = scheduler._resolveSession('arch', [{ action: 'to_arch', message: 'review' }]);
        assert.strictEqual(result.sessionId, 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        assert.strictEqual(result.isNew, false);
      });

      it('should not rotate when no in_progress module', () => {
        writeModulesProgress([
          { id: 'module_1', status: 'done' },
        ]);
        const result = scheduler._resolveSession('arch', [{ action: 'to_arch', message: 'uat phase' }]);
        assert.strictEqual(result.sessionId, 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        assert.strictEqual(result.isNew, false);
      });

      it('should not rotate on interrupt resume even if module mismatch', () => {
        writeModulesProgress([
          { id: 'module_2', status: 'in_progress' },
        ]);
        const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        data.partner.arch_agent.session.bound_module = 'module_1';
        fs.writeFileSync(projectJsonPath, JSON.stringify(data, null, 2));

        scheduler._resumeAfterInterrupt.arch = true;
        const result = scheduler._resolveSession('arch', [{ action: 'to_arch', from: 'human', message: 'stop' }]);
        assert.strictEqual(result.sessionId, 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        assert.strictEqual(result.isNew, false);
        const updated = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        assert.strictEqual(updated.partner.arch_agent.session.bound_module, 'module_1');
      });
    });
  });

  describe('_buildArgs', () => {
    it('should build args with --session-id for new session', () => {
      const args = scheduler._buildArgs('dev', 'uuid-123', true, 'hello');
      assert.ok(args.includes('-p'));
      assert.ok(args.includes('hello'));
      assert.ok(args.includes('--session-id'));
      assert.ok(args.includes('uuid-123'));
      assert.ok(args.includes('--system-prompt'));
      assert.ok(args.includes('--output-format'));
      assert.ok(args.includes('stream-json'));
    });

    it('should build args with --resume for existing session', () => {
      const args = scheduler._buildArgs('arch', 'uuid-456', false, 'world');
      assert.ok(args.includes('-p'));
      assert.ok(args.includes('world'));
      assert.ok(args.includes('--resume'));
      assert.ok(args.includes('uuid-456'));
      assert.ok(!args.includes('--session-id'));
    });

    it('should use embedded prompt for role', () => {
      const args = scheduler._buildArgs('uat', 'uuid-789', false, 'check');
      const promptIdx = args.indexOf('--system-prompt');
      assert.ok(promptIdx >= 0, 'should include --system-prompt');
      const promptContent = args[promptIdx + 1];
      assert.ok(promptContent.length > 100, 'embedded prompt should be substantial');
    });
  });

  describe('dispatch', () => {
    it('should enqueue and trigger execution for idle agent', (t, done) => {
      scheduler.on('spawn', (info) => {
        assert.strictEqual(info.role, 'arch');
        assert.strictEqual(info.isNew, false);
        assert.strictEqual(info.messageCount, 1);
        done();
      });

      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'hi arch',
      });
    });

    it('should skip actions with no agent target', () => {
      const skips = [];
      scheduler.on('skip', (info) => skips.push(info));

      scheduler.dispatch({
        action: 'to_human', from: 'arch', to: 'human', ts: 1, message: 'hi human',
      });

      assert.strictEqual(skips.length, 1);
      assert.strictEqual(skips[0].reason, 'no valid target agent');
    });

    it('should write processing ack note when human dispatches to agent', (t, done) => {
      const actionsFilePath = path.join(specDir, 'actions.jsonl');

      scheduler.on('spawn', () => {
        const lines = fs.readFileSync(actionsFilePath, 'utf-8').trim().split('\n');
        assert.strictEqual(lines.length, 1);
        const ack = JSON.parse(lines[0]);
        assert.strictEqual(ack.action, 'note');
        assert.strictEqual(ack.from, 'arch');
        assert.strictEqual(ack.to, 'human');
        assert.strictEqual(ack.message, 'get，开始处理中，稍等');
        assert.ok(typeof ack.ts === 'number');
        done();
      });

      scheduler.dispatch({
        action: 'to_arch', from: 'human', to: 'arch', ts: 1, message: 'hello arch',
      });
    });

    it('should not write processing ack for agent-to-agent dispatch', (t, done) => {
      const actionsFilePath = path.join(specDir, 'actions.jsonl');

      scheduler.on('spawn', () => {
        const content = fs.readFileSync(actionsFilePath, 'utf-8').trim();
        assert.strictEqual(content, '');
        done();
      });

      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'hi arch',
      });
    });

    it('should queue messages when agent is busy', (t, done) => {
      let spawnCount = 0;
      scheduler.on('spawn', (info) => {
        spawnCount++;
        if (spawnCount === 2) {
          // Second spawn should have merged messages
          assert.strictEqual(info.messageCount, 2);
          done();
        }
      });

      // First dispatch - agent becomes busy
      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'msg1',
      });

      // These should queue since arch is now busy
      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 2, message: 'msg2',
      });
      scheduler.dispatch({
        action: 'to_arch', from: 'human', to: 'arch', ts: 3, message: 'msg3',
      });
    });

    it('dev_do should create new session and archive old', (t, done) => {
      scheduler.on('spawn', (info) => {
        assert.strictEqual(info.role, 'dev');
        assert.strictEqual(info.isNew, true);
        assert.strictEqual(info.sessionId, 'new-uuid-0000-0000-000000000001');

        // Verify project json
        const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        assert.strictEqual(data.partner.dev_agent.session.runing, 'new-uuid-0000-0000-000000000001');
        assert.ok(data.partner.dev_agent.session.done.includes('1111-2222-3333-4444-555555555555'));
        done();
      });

      scheduler.dispatch({
        action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'implement feature',
      });
    });

    it('dev_fix should reuse current session', (t, done) => {
      scheduler.on('spawn', (info) => {
        assert.strictEqual(info.role, 'dev');
        assert.strictEqual(info.isNew, false);
        assert.strictEqual(info.sessionId, '1111-2222-3333-4444-555555555555');
        done();
      });

      scheduler.dispatch({
        action: 'dev_fix', from: 'arch', to: 'dev', ts: 1, message: 'fix bug',
      });
    });

    it('uat_check should create new session and archive old', (t, done) => {
      scheduler.on('spawn', (info) => {
        assert.strictEqual(info.role, 'uat');
        assert.strictEqual(info.isNew, true);
        assert.strictEqual(info.sessionId, 'new-uuid-0000-0000-000000000001');

        const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        assert.strictEqual(data.partner.uat_agent.session.runing, 'new-uuid-0000-0000-000000000001');
        assert.ok(data.partner.uat_agent.session.done.includes('ffff-0000-1111-2222-333333333333'));
        done();
      });

      scheduler.dispatch({
        action: 'uat_check', from: 'arch', to: 'uat', ts: 1, message: 'verify story',
      });
    });

    it('uat_fix should reuse current UAT session', (t, done) => {
      scheduler.on('spawn', (info) => {
        assert.strictEqual(info.role, 'uat');
        assert.strictEqual(info.isNew, false);
        assert.strictEqual(info.sessionId, 'ffff-0000-1111-2222-333333333333');
        done();
      });

      scheduler.dispatch({
        action: 'uat_fix', from: 'arch', to: 'uat', ts: 1, message: 'recheck story',
      });
    });
  });

  describe('completion handling', () => {
    it('should emit completed event with exit code 0', (t, done) => {
      scheduler.on('completed', (info) => {
        assert.strictEqual(info.role, 'arch');
        assert.strictEqual(info.exitCode, 0);
        assert.strictEqual(info.sessionId, 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
        done();
      });

      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'test',
      });
    });

    it('should mark agent idle after completion', (t, done) => {
      scheduler.on('completed', () => {
        assert.strictEqual(scheduler.isAgentBusy('arch'), false);
        done();
      });

      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'test',
      });
    });

    it('should process queued messages after completion', (t, done) => {
      let completions = 0;
      scheduler.on('completed', (info) => {
        completions++;
        if (completions === 2) {
          done();
        }
      });

      // First message
      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'first',
      });

      // Queue second while first is executing
      scheduler.dispatch({
        action: 'to_arch', from: 'human', to: 'arch', ts: 2, message: 'second',
      });
    });
  });

  describe('human interrupt', () => {
    it('should SIGINT a running agent and resume with interrupt notice', (t, done) => {
      const signals = [];
      let spawnCount = 0;
      const interruptScheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        uuidFn: () => 'new-uuid-0000-0000-000000000001',
        spawnFn: (cmd, args, opts) => {
          spawnCount++;
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = { write: () => {}, end: () => {} };
          proc.pid = 1000 + spawnCount;
          proc.kill = (signal) => {
            signals.push(signal);
            setTimeout(() => proc.emit('close', null, signal), 5);
            return true;
          };
          spawnCalls.push({ cmd, args, opts, proc });

          if (spawnCount === 2) {
            setTimeout(() => {
              proc.stdout.emit('data', Buffer.from('{"type":"result"}\n'));
              proc.emit('close', 0);
            }, 10);
          }
          return proc;
        },
      });

      const spawns = [];
      interruptScheduler.on('spawn', (info) => spawns.push(info));
      interruptScheduler.on('interrupted', (info) => {
        assert.strictEqual(info.role, 'arch');
        assert.strictEqual(info.sessionId, 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      });
      interruptScheduler.on('completed', (info) => {
        if (info.interrupted) return;
        try {
          assert.deepStrictEqual(signals, ['SIGINT']);
          assert.strictEqual(spawns.length, 2);
          assert.strictEqual(spawns[1].role, 'arch');
          assert.strictEqual(spawns[1].isNew, false);
          assert.ok(spawns[1].args.includes('--resume'));
          assert.ok(spawns[1].prompt.includes('上一轮执行被用户中断了'));
          assert.ok(spawns[1].prompt.includes('请改成新的方向'));
          assert.strictEqual(interruptScheduler.isAgentBusy('arch'), false);
          interruptScheduler.clearAllTimers();
          done();
        } catch (err) {
          done(err);
        }
      });

      interruptScheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'old work',
      });
      interruptScheduler.dispatch({
        action: 'to_arch', from: 'human', to: 'arch', ts: 2, message: '请改成新的方向',
      });
    });

    it('should resume current dev session after interrupting dev_do', (t, done) => {
      let spawnCount = 0;
      const devScheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        uuidFn: () => 'new-uuid-0000-0000-000000000001',
        spawnFn: (cmd, args, opts) => {
          spawnCount++;
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = { write: () => {}, end: () => {} };
          proc.pid = 2000 + spawnCount;
          proc.kill = (signal) => {
            setTimeout(() => proc.emit('close', null, signal), 5);
            return true;
          };
          spawnCalls.push({ cmd, args, opts, proc });

          if (spawnCount === 2) {
            setTimeout(() => proc.emit('close', 0), 10);
          }
          return proc;
        },
      });

      const spawns = [];
      devScheduler.on('spawn', (info) => spawns.push(info));
      devScheduler.on('completed', (info) => {
        if (info.interrupted) return;
        try {
          assert.strictEqual(spawns.length, 2);
          assert.strictEqual(spawns[0].role, 'dev');
          assert.strictEqual(spawns[0].isNew, true);
          assert.strictEqual(spawns[0].sessionId, 'new-uuid-0000-0000-000000000001');
          assert.strictEqual(spawns[1].role, 'dev');
          assert.strictEqual(spawns[1].isNew, false);
          assert.strictEqual(spawns[1].sessionId, 'new-uuid-0000-0000-000000000001');
          assert.ok(spawns[1].args.includes('--resume'));
          assert.ok(!spawns[1].args.includes('--session-id'));
          assert.ok(spawns[1].prompt.includes('先暂停，按这个新要求改'));
          devScheduler.clearAllTimers();
          done();
        } catch (err) {
          done(err);
        }
      });

      devScheduler.dispatch({
        action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'implement feature',
      });
      devScheduler.dispatch({
        action: 'to_dev', from: 'human', to: 'dev', ts: 2, message: '先暂停，按这个新要求改',
      });
    });
  });

  describe('error handling', () => {
    it('should handle spawn error gracefully', (t, done) => {
      const actionsFile = path.join(tmpDir, 'actions.jsonl');
      fs.writeFileSync(actionsFile, '');
      const errorScheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        spawnFn: (cmd, args, opts) => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = { write: () => {}, end: () => {} };
          proc.pid = 1;
          proc.kill = () => {};

          setTimeout(() => {
            proc.emit('error', new Error('spawn failed'));
          }, 5);

          return proc;
        },
        uuidFn: () => 'new-uuid-0000-0000-000000000001',
        claudeMaxRetries: 1,
        actionsFilePath: actionsFile,
      });

      errorScheduler.on('error', (info) => {
        assert.strictEqual(info.role, 'arch');
        assert.ok(info.error.includes('spawn failed'));
        assert.strictEqual(errorScheduler.isAgentBusy('arch'), false);
        errorScheduler.clearAllTimers();
        done();
      });

      errorScheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'test',
      });
    });
  });

  describe('missing Claude conversation repair', () => {
    it('should replace missing resume session and retry with --session-id', (t, done) => {
      const actionsFile = path.join(tmpDir, 'actions.jsonl');
      fs.writeFileSync(actionsFile, '');

      let spawnCount = 0;
      const repairScheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        spawnFn: (cmd, args, opts) => {
          spawnCount++;
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = { write: () => {}, end: () => {} };
          proc.pid = 3000 + spawnCount;
          spawnCalls.push({ cmd, args, opts, proc });

          setTimeout(() => {
            if (spawnCount === 1) {
              proc.stderr.emit('data', Buffer.from('No conversation found'));
              proc.emit('close', 1);
            } else {
              proc.stdout.emit('data', Buffer.from('{"type":"result"}\n'));
              proc.emit('close', 0);
            }
          }, 5);

          return proc;
        },
        uuidFn: () => 'new-uuid-0000-0000-000000000001',
        claudeRetryDelayMs: 1,
        actionsFilePath: actionsFile,
      });

      const spawns = [];
      repairScheduler.on('spawn', (info) => spawns.push(info));
      repairScheduler.on('completed', (info) => {
        if (info.role === 'uat' && info.exitCode === 0) {
          const updated = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
          try {
            assert.strictEqual(spawns.length, 2);
            assert.strictEqual(spawns[0].sessionId, 'ffff-0000-1111-2222-333333333333');
            assert.strictEqual(spawns[0].isNew, false);
            assert.ok(spawns[0].args.includes('--resume'));
            assert.strictEqual(spawns[1].sessionId, 'new-uuid-0000-0000-000000000001');
            assert.strictEqual(spawns[1].isNew, true);
            assert.ok(spawns[1].args.includes('--session-id'));
            assert.strictEqual(updated.partner.uat_agent.session.runing, 'new-uuid-0000-0000-000000000001');
            repairScheduler.clearAllTimers();
            done();
          } catch (err) {
            repairScheduler.clearAllTimers();
            done(err);
          }
        }
      });

      repairScheduler.dispatch({
        action: 'uat_fix', from: 'arch', to: 'uat', ts: 1, message: 'recheck story',
      });
    });

    it('should recognize real Claude missing-session stderr', () => {
      assert.strictEqual(
        scheduler._isMissingConversationError('No conversation found with session ID: f47ac10b-58cc-4372-a567-0e02b2c3d479'),
        true
      );
    });

    it('should not write legacy initialized after successful completion', (t, done) => {
      scheduler.on('completed', (info) => {
        if (info.role === 'arch') {
          const updated = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
          assert.strictEqual(updated.partner.arch_agent.session.initialized, undefined);
          done();
        }
      });

      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'test completion',
      });
    });
  });

  describe('isAgentBusy / getPendingCount', () => {
    it('should report busy state correctly', () => {
      assert.strictEqual(scheduler.isAgentBusy('arch'), false);

      scheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'test',
      });

      assert.strictEqual(scheduler.isAgentBusy('arch'), true);
    });

    it('should report pending count correctly', () => {
      assert.strictEqual(scheduler.getPendingCount('dev'), 0);

      // Make dev busy first
      scheduler.dispatch({
        action: 'dev_do', from: 'arch', to: 'dev', ts: 1, message: 'task1',
      });

      // Now queue more
      scheduler.dispatch({
        action: 'dev_fix', from: 'arch', to: 'dev', ts: 2, message: 'task2',
      });

      assert.strictEqual(scheduler.getPendingCount('dev'), 1);
    });
  });

  describe('Feature #13: Timeout + Retry + Dead Letter', () => {
    let actionsFile;

    beforeEach(() => {
      actionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');
      fs.writeFileSync(actionsFile, '');
    });

    describe('timeout', () => {
      it('should kill process after timeout via SIGTERM', (t, done) => {
        let killSignals = [];
        const hangScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 12345;
            proc.kill = (signal) => {
              killSignals.push(signal);
              if (signal === 'SIGTERM') {
                // Simulate process responding to SIGTERM
                setTimeout(() => proc.emit('close', null, 'SIGTERM'), 5);
              }
            };
            spawnCalls.push({ cmd, args, opts, proc });
            // Process never exits on its own (simulates hang)
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 50,      // Short timeout for testing
          claudeKillGraceMs: 30,    // Short grace for testing
          claudeMaxRetries: 1,      // Avoid multiple retries in test
          actionsFilePath: actionsFile,
        });

        hangScheduler.on('timeout', (info) => {
          assert.strictEqual(info.role, 'arch');
          assert.strictEqual(info.timeoutMs, 50);
        });

        hangScheduler.on('completed', (info) => {
          assert.strictEqual(info.timedOut, true);
          assert.ok(killSignals.includes('SIGTERM'));
          hangScheduler.clearAllTimers();
          done();
        });

        hangScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'hang task',
        });
      });

      it('should SIGKILL after grace period if SIGTERM does not kill', (t, done) => {
        let killSignals = [];
        const hangScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 12345;
            proc.kill = (signal) => {
              killSignals.push(signal);
              // Only respond to SIGKILL (SIGTERM ignored = process resists)
              if (signal === 'SIGKILL') {
                setTimeout(() => proc.emit('close', null, 'SIGKILL'), 5);
              }
            };
            spawnCalls.push({ cmd, args, opts, proc });
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 30,
          claudeKillGraceMs: 30,
          claudeMaxRetries: 1,
          actionsFilePath: actionsFile,
        });

        hangScheduler.on('completed', (info) => {
          assert.ok(killSignals.includes('SIGTERM'));
          assert.ok(killSignals.includes('SIGKILL'));
          assert.strictEqual(info.timedOut, true);
          hangScheduler.clearAllTimers();
          done();
        });

        hangScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'really hang',
        });
      });
    });

    describe('retry on non-zero exit', () => {
      it('should prepend messages back to queue and retry after delay', (t, done) => {
        let spawnCount = 0;
        const retryScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = Math.floor(Math.random() * 99999);
            proc.kill = () => {};
            spawnCalls.push({ cmd, args, opts, proc });
            spawnCount++;
            const currentCount = spawnCount;
            setTimeout(() => {
              // First 2 attempts fail, 3rd succeeds
              const code = currentCount <= 2 ? 1 : 0;
              proc.emit('close', code);
            }, 5);
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 60000,
          claudeRetryDelayMs: 20,   // Short delay for testing
          claudeMaxRetries: 3,
          actionsFilePath: actionsFile,
        });

        let retryEvents = [];
        retryScheduler.on('retry', (info) => {
          retryEvents.push(info);
        });

        retryScheduler.on('completed', (info) => {
          if (info.exitCode === 0) {
            // Should have retried twice before succeeding
            assert.strictEqual(retryEvents.length, 2);
            assert.strictEqual(retryEvents[0].retryCount, 1);
            assert.strictEqual(retryEvents[1].retryCount, 2);
            assert.strictEqual(spawnCount, 3);
            retryScheduler.clearAllTimers();
            done();
          }
        });

        retryScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'retry me',
        });
      });

      it('should carry _retryCount on prepended messages', (t, done) => {
        let spawnCount = 0;
        const retryScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = () => {};
            spawnCount++;
            setTimeout(() => proc.emit('close', 1), 5);
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 60000,
          claudeRetryDelayMs: 10,
          claudeMaxRetries: 3,
          actionsFilePath: actionsFile,
        });

        let spawnEvents = [];
        retryScheduler.on('spawn', (info) => {
          spawnEvents.push(info);
        });

        retryScheduler.on('dead-letter', (info) => {
          // After 3 failures, retryCount in spawn events should increment
          assert.strictEqual(spawnEvents[0].retryCount, 0);
          assert.strictEqual(spawnEvents[1].retryCount, 1);
          assert.strictEqual(spawnEvents[2].retryCount, 2);
          retryScheduler.clearAllTimers();
          done();
        });

        retryScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'will fail',
        });
      });

      it('should delay retry by configured delay', (t, done) => {
        let spawnTimes = [];
        const retryScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = () => {};
            spawnTimes.push(Date.now());
            setTimeout(() => proc.emit('close', 1), 5);
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 60000,
          claudeRetryDelayMs: 50,  // 50ms delay
          claudeMaxRetries: 2,
          actionsFilePath: actionsFile,
        });

        retryScheduler.on('dead-letter', () => {
          // Should have 2 spawn times with ~50ms gap
          assert.strictEqual(spawnTimes.length, 2);
          const gap = spawnTimes[1] - spawnTimes[0];
          assert.ok(gap >= 40, `Gap was ${gap}ms, expected >= 40ms`);
          retryScheduler.clearAllTimers();
          done();
        });

        retryScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'delay test',
        });
      });
    });

    describe('dead letter', () => {
      it('should write dead letter to actions.jsonl after max retries', (t, done) => {
        const deadScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = () => {};
            setTimeout(() => proc.emit('close', 1), 5);
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 60000,
          claudeRetryDelayMs: 10,
          claudeMaxRetries: 2,
          actionsFilePath: actionsFile,
        });

        deadScheduler.on('dead-letter', (info) => {
          assert.strictEqual(info.role, 'arch');
          assert.ok(info.reason.includes('exit code 1'));
          assert.ok(info.message.includes('Agent arch'));
          assert.ok(info.message.includes('已重试 2 次'));

          // Verify file was written
          const content = fs.readFileSync(actionsFile, 'utf-8').trim();
          const action = JSON.parse(content);
          assert.strictEqual(action.action, 'to_human');
          assert.strictEqual(action.from, 'arch');
          assert.strictEqual(action.to, 'human');
          assert.ok(action.message.includes('dead letter message'));

          deadScheduler.clearAllTimers();
          done();
        });

        deadScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'dead letter message that is long enough to test truncation behavior',
        });
      });

      it('should include first 200 chars of prompt in dead letter message', (t, done) => {
        const longMsg = 'A'.repeat(300);
        const deadScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = () => {};
            setTimeout(() => proc.emit('close', 1), 5);
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 60000,
          claudeRetryDelayMs: 10,
          claudeMaxRetries: 1,
          actionsFilePath: actionsFile,
        });

        deadScheduler.on('dead-letter', (info) => {
          // Summary should be truncated to 200 chars
          const content = fs.readFileSync(actionsFile, 'utf-8').trim();
          const action = JSON.parse(content);
          assert.ok(action.message.includes('A'.repeat(200)));
          assert.ok(!action.message.includes('A'.repeat(201)));
          deadScheduler.clearAllTimers();
          done();
        });

        deadScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: longMsg,
        });
      });

      it('should include failure reason (timeout) in dead letter', (t, done) => {
        const deadScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = (signal) => {
              if (signal === 'SIGTERM') {
                setTimeout(() => proc.emit('close', null, 'SIGTERM'), 5);
              }
            };
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 20,
          claudeKillGraceMs: 30,
          claudeRetryDelayMs: 10,
          claudeMaxRetries: 1,
          actionsFilePath: actionsFile,
        });

        deadScheduler.on('dead-letter', (info) => {
          assert.ok(info.reason.includes('timeout'));
          deadScheduler.clearAllTimers();
          done();
        });

        deadScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'timeout msg',
        });
      });

      it('should recover idle state after dead letter (not block queue)', (t, done) => {
        let spawnCount = 0;
        const recoverScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = () => {};
            spawnCount++;
            const current = spawnCount;
            setTimeout(() => {
              // First attempt → dead letter (maxRetries=1), second succeeds
              proc.emit('close', current <= 1 ? 1 : 0);
            }, 5);
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 60000,
          claudeRetryDelayMs: 10,
          claudeMaxRetries: 1,
          actionsFilePath: actionsFile,
        });

        recoverScheduler.on('dead-letter', () => {
          // After dead letter, queue should be idle
          assert.strictEqual(recoverScheduler.isAgentBusy('arch'), false);

          // Send a new message — should process normally
          recoverScheduler.dispatch({
            action: 'to_arch', from: 'dev', to: 'arch', ts: 2, message: 'after dead letter',
          });
        });

        recoverScheduler.on('completed', (info) => {
          if (info.exitCode === 0) {
            assert.strictEqual(info.role, 'arch');
            recoverScheduler.clearAllTimers();
            done();
          }
        });

        recoverScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'will fail',
        });
      });
    });

    describe('Feature #14: reply fallback', () => {
      it('should auto-append fallback when agent exits 0 without writing actions.jsonl', (t, done) => {
        const fbScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = () => {};
            setTimeout(() => {
              // Emit stream-json with result
              proc.stdout.emit('data', Buffer.from('{"type":"result","result":"我已完成任务"}\n'));
              proc.emit('close', 0);
            }, 10);
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          actionsFilePath: actionsFile,
        });

        fbScheduler.on('fallback', (info) => {
          assert.strictEqual(info.role, 'arch');
          assert.strictEqual(info.action.action, 'to_human');
          assert.strictEqual(info.action.from, 'arch');
          assert.strictEqual(info.action.message, '我已完成任务');
        });

        fbScheduler.on('completed', (info) => {
          if (info.exitCode === 0) {
            assert.strictEqual(info.fallback.applied, true);
            // Verify file written
            const content = fs.readFileSync(actionsFile, 'utf-8').trim();
            assert.ok(content.length > 0);
            const parsed = JSON.parse(content.split('\n').pop());
            assert.strictEqual(parsed.from, 'arch');
            fbScheduler.clearAllTimers();
            done();
          }
        });

        fbScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'do something',
        });
      });

      it('should NOT append fallback when agent already wrote to actions.jsonl', (t, done) => {
        // Pre-write a line from arch (simulating agent writing during execution)
        // We need the line to appear after spawnOffset, so we write it during spawn
        const fbScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = () => {};
            setTimeout(() => {
              // Agent writes to actions.jsonl during execution
              fs.appendFileSync(actionsFile, '{"action":"to_human","from":"arch","to":"human","ts":99,"message":"agent wrote this"}\n');
              proc.stdout.emit('data', Buffer.from('{"type":"result","result":"also replied in stdout"}\n'));
              proc.emit('close', 0);
            }, 10);
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          actionsFilePath: actionsFile,
        });

        fbScheduler.on('completed', (info) => {
          if (info.exitCode === 0) {
            assert.strictEqual(info.fallback.applied, false);
            assert.strictEqual(info.fallback.reason, 'already-written');
            fbScheduler.clearAllTimers();
            done();
          }
        });

        fbScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'do something',
        });
      });

      it('should NOT append fallback when stdout has no result event', (t, done) => {
        const fbScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = () => {};
            setTimeout(() => {
              proc.stdout.emit('data', Buffer.from('{"type":"system","subtype":"init"}\n'));
              proc.emit('close', 0);
            }, 10);
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          actionsFilePath: actionsFile,
        });

        fbScheduler.on('completed', (info) => {
          if (info.exitCode === 0) {
            assert.strictEqual(info.fallback.applied, false);
            assert.strictEqual(info.fallback.reason, 'no-result');
            fbScheduler.clearAllTimers();
            done();
          }
        });

        fbScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'no result',
        });
      });
    });

    describe('clearAllTimers', () => {
      it('should cancel pending timeout and retry timers', () => {
        const timerScheduler = new AgentScheduler({
          projectJsonPath,
          specDir,
          spawnFn: (cmd, args, opts) => {
            const proc = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: () => {}, end: () => {} };
            proc.pid = 1;
            proc.kill = () => {};
            // Never exits
            return proc;
          },
          uuidFn: () => 'new-uuid-0000-0000-000000000001',
          claudeTimeoutMs: 99999,
          actionsFilePath: actionsFile,
        });

        timerScheduler.dispatch({
          action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'timer test',
        });

        // Timeout timer should be set
        assert.notStrictEqual(timerScheduler._timeoutTimers.arch, null);

        // Clear all timers
        timerScheduler.clearAllTimers();

        assert.strictEqual(timerScheduler._timeoutTimers.arch, null);
        assert.strictEqual(timerScheduler._killTimers.arch, null);
        assert.strictEqual(timerScheduler._retryTimers.arch, null);
      });
    });
  });

  describe('Feature #22: _processStdoutChunk (line buffering + parsing)', () => {
    let f22ActionsFile;

    beforeEach(() => {
      f22ActionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');
      fs.mkdirSync(path.join(tmpDir, 'spec'), { recursive: true });
      fs.writeFileSync(f22ActionsFile, '');
    });

    it('should emit agent-log for complete JSON lines', (t, done) => {
      const logScheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        spawnFn: (cmd, args, opts) => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = { write: () => {}, end: () => {} };
          proc.pid = 1;
          proc.kill = () => {};
          setTimeout(() => {
            const textLine = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello world' }] } }) + '\n';
            proc.stdout.emit('data', Buffer.from(textLine));
            proc.emit('close', 0);
          }, 10);
          return proc;
        },
        uuidFn: () => 'new-uuid-0000-0000-000000000001',
        actionsFilePath: f22ActionsFile,
      });

      logScheduler.on('agent-log', (data) => {
        assert.strictEqual(data.role, 'arch');
        assert.ok(Array.isArray(data.lines));
        assert.strictEqual(data.lines.length, 1);
        assert.strictEqual(data.lines[0].content, 'hello world');
      });

      logScheduler.on('completed', () => {
        logScheduler.clearAllTimers();
        done();
      });

      logScheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'parse test',
      });
    });

    it('should buffer partial lines across chunks', (t, done) => {
      const logEvents = [];
      const logScheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        spawnFn: (cmd, args, opts) => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = { write: () => {}, end: () => {} };
          proc.pid = 1;
          proc.kill = () => {};

          const fullLine = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'split across chunks' }] } });
          const half1 = fullLine.substring(0, 20);
          const half2 = fullLine.substring(20) + '\n';

          setTimeout(() => {
            // Send first half (no newline → buffered, no emit)
            proc.stdout.emit('data', Buffer.from(half1));
            // Send second half with newline → should now emit
            proc.stdout.emit('data', Buffer.from(half2));
            proc.emit('close', 0);
          }, 10);
          return proc;
        },
        uuidFn: () => 'new-uuid-0000-0000-000000000001',
        actionsFilePath: f22ActionsFile,
      });

      logScheduler.on('agent-log', (data) => {
        logEvents.push(data);
      });

      logScheduler.on('completed', () => {
        // Should have emitted exactly once (when second chunk completed the line)
        assert.strictEqual(logEvents.length, 1);
        assert.strictEqual(logEvents[0].lines[0].content, 'split across chunks');
        logScheduler.clearAllTimers();
        done();
      });

      logScheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'buffer test',
      });
    });

    it('should skip system/result events (emit no agent-log)', (t, done) => {
      const logEvents = [];
      const logScheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        spawnFn: (cmd, args, opts) => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = { write: () => {}, end: () => {} };
          proc.pid = 1;
          proc.kill = () => {};
          setTimeout(() => {
            const systemLine = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }) + '\n';
            const resultLine = JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }) + '\n';
            proc.stdout.emit('data', Buffer.from(systemLine + resultLine));
            proc.emit('close', 0);
          }, 10);
          return proc;
        },
        uuidFn: () => 'new-uuid-0000-0000-000000000001',
        actionsFilePath: f22ActionsFile,
      });

      logScheduler.on('agent-log', (data) => {
        logEvents.push(data);
      });

      logScheduler.on('completed', () => {
        // system and result events are skipped → no agent-log emit
        assert.strictEqual(logEvents.length, 0);
        logScheduler.clearAllTimers();
        done();
      });

      logScheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'skip test',
      });
    });

    it('should handle multiple lines in single chunk', (t, done) => {
      const logEvents = [];
      const logScheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        spawnFn: (cmd, args, opts) => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = { write: () => {}, end: () => {} };
          proc.pid = 1;
          proc.kill = () => {};
          setTimeout(() => {
            const line1 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } });
            const line2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'second' }] } });
            proc.stdout.emit('data', Buffer.from(line1 + '\n' + line2 + '\n'));
            proc.emit('close', 0);
          }, 10);
          return proc;
        },
        uuidFn: () => 'new-uuid-0000-0000-000000000001',
        actionsFilePath: f22ActionsFile,
      });

      logScheduler.on('agent-log', (data) => {
        logEvents.push(data);
      });

      logScheduler.on('completed', () => {
        // Both lines in one chunk → one agent-log with 2 items
        assert.strictEqual(logEvents.length, 1);
        assert.strictEqual(logEvents[0].lines.length, 2);
        assert.strictEqual(logEvents[0].lines[0].content, 'first');
        assert.ok(logEvents[0].lines[1].content.startsWith('[思考]'));
        logScheduler.clearAllTimers();
        done();
      });

      logScheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'multi test',
      });
    });

    it('should reset line buffer on process close', (t, done) => {
      const logScheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        spawnFn: (cmd, args, opts) => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = { write: () => {}, end: () => {} };
          proc.pid = 1;
          proc.kill = () => {};
          setTimeout(() => {
            // Send partial line without newline → stays in buffer
            proc.stdout.emit('data', Buffer.from('{"type":"assistant","subtype":'));
            proc.emit('close', 0);
          }, 10);
          return proc;
        },
        uuidFn: () => 'new-uuid-0000-0000-000000000001',
        actionsFilePath: f22ActionsFile,
      });

      logScheduler.on('completed', () => {
        // Buffer should be cleared on close
        assert.strictEqual(logScheduler._lineBuffers.arch, '');
        logScheduler.clearAllTimers();
        done();
      });

      logScheduler.dispatch({
        action: 'to_arch', from: 'dev', to: 'arch', ts: 1, message: 'reset test',
      });
    });
  });

  describe('Feature #16: killAllProcesses', () => {
    it('killAllProcesses should return list of tracked processes', async () => {
      // Use a spawn that creates a real short-lived child we can track
      const { spawn: realSpawn } = require('child_process');
      const longSpawn = (cmd, args, opts) => {
        // Spawn a real process that sleeps
        const proc = realSpawn('node', ['-e', 'setTimeout(()=>{},60000)'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        spawnCalls.push({ cmd, args, opts, proc });
        return proc;
      };

      scheduler = new AgentScheduler({
        projectJsonPath,
        specDir,
        spawnFn: longSpawn,
        actionsFilePath: path.join(tmpDir, 'actions.jsonl'),
        claudeTimeoutMs: 999999,
      });

      fs.writeFileSync(path.join(tmpDir, 'actions.jsonl'), '');

      scheduler.dispatch({
        action: 'to_arch', from: 'human', to: 'arch', ts: 1, message: 'long',
      });

      // Wait for spawn
      await new Promise(r => setTimeout(r, 50));

      // Process should be tracked
      assert.ok(scheduler.getProcess('arch'));

      const killed = scheduler.killAllProcesses();
      assert.strictEqual(killed.length, 1);
      assert.strictEqual(killed[0].role, 'arch');
      assert.ok(typeof killed[0].pid === 'number');

      scheduler.clearAllTimers();
      // Wait for process to actually die
      await new Promise(r => setTimeout(r, 100));
    });
  });
});
