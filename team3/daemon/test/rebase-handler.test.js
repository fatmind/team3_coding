'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const RebaseHandler = require('../src/rebase-handler');

describe('RebaseHandler', () => {
  let tmpDir;
  let specDir;
  let projectJsonPath;
  let actionsFilePath;
  let handler;
  let spawnCalls;

  /**
   * Mock spawn: emits a stream-json result line, optionally writes the
   * result file / performs file moves before exiting (simulating the
   * archive agent doing the work itself).
   */
  function createMockSpawn({ exitCode = 0, delay = 10, replyText = '提案：...', onRun = null } = {}) {
    return (cmd, args, opts) => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdin = { write: () => {}, end: () => {} };
      proc.pid = Math.floor(Math.random() * 99999);
      proc.kill = () => { proc.emit('close', null, 'SIGTERM'); return true; };

      spawnCalls.push({ cmd, args, opts, proc });

      setTimeout(() => {
        if (onRun) onRun(spawnCalls.length);
        if (replyText != null) {
          proc.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'result', result: replyText }) + '\n'));
        }
        proc.emit('close', exitCode);
      }, delay);

      return proc;
    };
  }

  function readActions() {
    const raw = fs.readFileSync(actionsFilePath, 'utf-8');
    return raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  }

  function readProjectJson() {
    return JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
  }

  function writeLogEntry(status, body = '') {
    fs.appendFileSync(
      path.join(specDir, 'rebase_log.md'),
      `## 2026-07-28 18:00 | ${status}\n${body}${body ? '\n' : ''}`
    );
  }

  function makeHandler(spawnFn) {
    return new RebaseHandler({
      workspaceDir: tmpDir,
      specDir,
      actionsFilePath,
      projectJsonPath,
      spawnFn,
      uuidFn: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      rebaseTimeoutMs: 5000,
    });
  }

  function waitFor(emitter, event) {
    return new Promise((resolve) => emitter.once(event, resolve));
  }

  const REBASE_ACTION = {
    action: 'rebase',
    from: 'human',
    to: 'arch',
    ts: 1000,
    message: '方向已调整，以新基准为准 [reread: spec/app_design.md, spec/baseline.md]',
  };

  const REPLY_ACTION = {
    action: 'rebase',
    from: 'human',
    to: 'arch',
    ts: 2000,
    message: '确认',
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-test-'));
    specDir = path.join(tmpDir, 'spec');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    actionsFilePath = path.join(specDir, 'actions.jsonl');
    spawnCalls = [];

    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(actionsFilePath, '');
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      partner: {
        arch_agent: { session: { runing: 'old-arch-session', bound_module: 'module_1', done: [] } },
      },
    }, null, 2));

    fs.writeFileSync(path.join(specDir, 'app_design.md'), '# 新基准');
    fs.writeFileSync(path.join(specDir, 'baseline.md'), '# 新基准2');
    fs.writeFileSync(path.join(specDir, 'stale_doc.md'), '# 哈希链设计（已推翻）');
  });

  afterEach(() => {
    if (handler) handler.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('phase 1: new rebase → proposal conversation', () => {
    it('spawns a fresh-session archive agent with whitelist and override system prompt', async () => {
      handler = makeHandler(createMockSpawn({ replyText: '提案：spec/stale_doc.md 整文件归档' }));

      handler.handle(REBASE_ACTION);
      await waitFor(handler, 'awaiting-reply');

      assert.equal(spawnCalls.length, 1);
      const { args } = spawnCalls[0];
      assert.ok(args.includes('--session-id'), 'first run must be a new session');
      const prompt = args[args.indexOf('-p') + 1];
      assert.match(prompt, /spec\/app_design\.md, spec\/baseline\.md/);
      assert.match(prompt, /只输出提案文本，不改任何文件/);
      const sysPrompt = args[args.indexOf('--system-prompt') + 1];
      assert.match(sysPrompt, /归档助手/);
      assert.match(sysPrompt, /局部段落过期/);
      // must NOT carry the arch role prompt
      assert.doesNotMatch(sysPrompt, /Architect|module_X_feature_list/);
    });

    it('forwards the agent proposal to human with reply hint, persists pending', async () => {
      handler = makeHandler(createMockSpawn({ replyText: '提案：spec/stale_doc.md — 哈希链已被推翻' }));

      handler.handle(REBASE_ACTION);
      await waitFor(handler, 'awaiting-reply');

      const toHuman = readActions().find(a => a.action === 'to_human');
      assert.equal(toHuman.from, 'T3');
      assert.match(toHuman.message, /哈希链已被推翻/);
      assert.match(toHuman.message, /[rebase: 确认]/);

      const pj = readProjectJson();
      assert.equal(pj.rebase.role, 'arch');
      assert.equal(pj.rebase.sessionId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      assert.deepEqual(pj.rebase.whitelist, ['spec/app_design.md', 'spec/baseline.md']);
      assert.equal(pj.rebase.message, REBASE_ACTION.message);
    });

    it('drops the rebase when the first scan exits non-zero', async () => {
      handler = makeHandler(createMockSpawn({ exitCode: 1, replyText: null }));

      handler.handle(REBASE_ACTION);
      await waitFor(handler, 'agent-failed');

      const toHuman = readActions().find(a => a.action === 'to_human');
      assert.match(toHuman.message, /扫描失败/);
      assert.equal(readProjectJson().rebase, undefined);
    });
  });

  describe('phase 2: pending rebase → reply resumes same session', () => {
    async function setupPending() {
      handler = makeHandler(createMockSpawn({ replyText: '提案：spec/stale_doc.md' }));
      handler.handle(REBASE_ACTION);
      await waitFor(handler, 'awaiting-reply');
    }

    it('resumes the SAME session on follow-up rebase message', async () => {
      await setupPending();
      handler.spawnFn = createMockSpawn({ replyText: '好的，已调整提案：仅归档 stale_doc.md' });
      spawnCalls = [];

      handler.handle({ ...REPLY_ACTION, message: '保留 stale_doc.md 里的第 2 节' });
      await waitFor(handler, 'awaiting-reply');

      const { args } = spawnCalls[0];
      assert.ok(args.includes('--resume'), 'reply must resume the session');
      assert.equal(args[args.indexOf('--resume') + 1], 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      const prompt = args[args.indexOf('-p') + 1];
      assert.match(prompt, /保留 stale_doc\.md 里的第 2 节/);
      // still pending — conversation continues
      assert.ok(readProjectJson().rebase);
    });

    it('finalizes on executed log entry: clears session, redispatches rebase message', async () => {
      await setupPending();
      // agent executes: moves file itself + appends a log entry
      handler.spawnFn = createMockSpawn({
        replyText: '归档完成',
        onRun: () => {
          fs.mkdirSync(path.join(tmpDir, 'archive'), { recursive: true });
          fs.renameSync(path.join(specDir, 'stale_doc.md'), path.join(tmpDir, 'archive', 'stale_doc.md'));
          writeLogEntry('executed', [
            '- 新基准: 以 app_design.md 为准',
            '- 整文件归档: spec/stale_doc.md',
            '- 局部清理: spec/baseline.md — 删除已废止的第 3 节',
            '- 说明: 完成',
          ].join('\n'));
        },
      });

      handler.handle(REPLY_ACTION);
      const { entry } = await waitFor(handler, 'executed');

      assert.equal(entry.status, 'executed');
      // session cleared
      const pj = readProjectJson();
      const session = pj.partner.arch_agent.session;
      assert.equal(session.runing, '');
      assert.ok(session.done.includes('old-arch-session'));
      assert.equal(session.bound_module, null);
      assert.equal(pj.rebase, undefined);
      // log is append-only — entry stays for audit
      assert.match(fs.readFileSync(path.join(specDir, 'rebase_log.md'), 'utf-8'), /executed/);

      const actions = readActions();
      const redispatch = actions.find(a => a.action === 'to_arch' && a.to === 'arch');
      assert.equal(redispatch.from, 'T3');
      assert.match(redispatch.message, /重新建立项目全局认识/);
      // original rebase text is NOT replayed — archive agent already executed it
      assert.ok(!redispatch.message.includes(REBASE_ACTION.message));

      const receipt = actions.filter(a => a.action === 'to_human').pop();
      assert.match(receipt.message, /归档完成/);
      assert.match(receipt.message, /spec\/stale_doc\.md/);
      assert.match(receipt.message, /删除已废止的第 3 节/);
    });

    it('only reacts to entries appended by THIS run (older log entries ignored)', async () => {
      // a previous rebase already logged an executed entry
      writeLogEntry('executed', '- 说明: 上一次 rebase 的记录');
      await setupPending();
      // this run replies without appending anything new
      handler.spawnFn = createMockSpawn({ replyText: '提案已更新，请确认' });

      handler.handle({ ...REPLY_ACTION, message: '再看看' });
      await waitFor(handler, 'awaiting-reply');

      // old entry must NOT trigger finalize
      assert.ok(readProjectJson().rebase, 'pending must survive');
      assert.equal(readProjectJson().partner.arch_agent.session.runing, 'old-arch-session');
    });

    it('warns when a whitelist file went missing after execution', async () => {
      await setupPending();
      handler.spawnFn = createMockSpawn({
        replyText: '归档完成',
        onRun: () => {
          fs.unlinkSync(path.join(specDir, 'baseline.md')); // agent误删白名单
          writeLogEntry('executed', '- 整文件归档: spec/baseline.md');
        },
      });

      handler.handle(REPLY_ACTION);
      const { whitelistLost } = await waitFor(handler, 'executed');

      assert.deepEqual(whitelistLost, ['spec/baseline.md']);
      const receipt = readActions().filter(a => a.action === 'to_human').pop();
      assert.match(receipt.message, /白名单文件缺失/);
    });

    it('cancels without touching session when a cancelled entry is appended', async () => {
      await setupPending();
      handler.spawnFn = createMockSpawn({
        replyText: '好的，已取消',
        onRun: () => writeLogEntry('cancelled', '- 原因: 人类放弃本次 rebase'),
      });

      handler.handle({ ...REPLY_ACTION, message: '算了，不归档了' });
      await waitFor(handler, 'cancelled');

      assert.equal(readProjectJson().rebase, undefined);
      assert.equal(readProjectJson().partner.arch_agent.session.runing, 'old-arch-session');
      assert.ok(!readActions().some(a => a.action === 'to_arch'));
      const toHuman = readActions().filter(a => a.action === 'to_human').pop();
      assert.match(toHuman.message, /已取消/);
    });

    it('keeps pending when a resume run fails (session can recover)', async () => {
      await setupPending();
      handler.spawnFn = createMockSpawn({ exitCode: 1, replyText: null });

      handler.handle(REPLY_ACTION);
      await waitFor(handler, 'agent-failed');

      assert.ok(readProjectJson().rebase, 'pending must survive a mid-conversation failure');
      const toHuman = readActions().filter(a => a.action === 'to_human').pop();
      assert.match(toHuman.message, /仍在进行中/);
    });
  });

  it('rejects a new rebase while the agent process is still running', async () => {
    handler = makeHandler(createMockSpawn({ delay: 200, replyText: '提案' }));
    handler.handle(REBASE_ACTION);
    handler.handle({ ...REBASE_ACTION, ts: 1001 });

    const toHuman = readActions().find(a => a.action === 'to_human');
    assert.match(toHuman.message, /正在执行中/);
    assert.equal(spawnCalls.length, 1);
    await waitFor(handler, 'awaiting-reply');
  });
});
