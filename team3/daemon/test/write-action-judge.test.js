'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CLI_PATH = path.resolve(__dirname, '../../cli/write-action.mjs');

// Stub judge：可执行脚本，接收 -p <prompt>，按 STUB_JUDGE_MODE 输出判卷结果
const STUB_JUDGE_SOURCE = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const mode = process.env.STUB_JUDGE_MODE || 'pass';
if (process.env.STUB_JUDGE_LOG) {
  fs.appendFileSync(process.env.STUB_JUDGE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
}
if (mode === 'pass') {
  process.stdout.write('{"type":"decision","pass":true,"fails":[]}\\n');
} else if (mode === 'fail') {
  process.stdout.write('判卷结果如下：\\n{"type":"decision","pass":false,"fails":[{"id":"④","reason":"出现了 你觉得"},{"id":"⑦","reason":"大段实现细节"}]}\\n');
} else if (mode === 'garbage') {
  process.stdout.write('我不知道该输出什么\\n');
} else if (mode === 'broken-json-fail') {
  process.stdout.write('{"type":"decision","pass":false,"fails":[{"id":"④","reason":"问"你倾向哪条"，推回人类"}]}\\n');
} else if (mode === 'crash') {
  process.stderr.write('boom\\n');
  process.exit(3);
}
`;

describe('write-action.mjs to_human judge', () => {
  let tmpDir;
  let jsonlPath;
  let stubPath;
  let stubLogPath;

  function run(args, env = {}) {
    return spawnSync('node', [CLI_PATH, jsonlPath, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, TEAM3_JUDGE_CMD: stubPath, STUB_JUDGE_LOG: stubLogPath, ...env },
    });
  }

  function readEntries() {
    if (!fs.existsSync(jsonlPath)) return [];
    return fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse);
  }

  function judgeCallCount() {
    if (!fs.existsSync(stubLogPath)) return 0;
    return fs.readFileSync(stubLogPath, 'utf-8').trim().split('\n').filter(Boolean).length;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-action-judge-'));
    jsonlPath = path.join(tmpDir, 'spec', 'actions.jsonl');
    stubPath = path.join(tmpDir, 'stub-judge.js');
    stubLogPath = path.join(tmpDir, 'stub-judge.log');
    fs.writeFileSync(stubPath, STUB_JUDGE_SOURCE, { mode: 0o755 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('to_human + 判卷通过 → 写入成功', () => {
    const res = run(['--action', 'to_human', '--from', 'arch', '--to', 'human', '--message', '【老板你定】建议X'],
      { STUB_JUDGE_MODE: 'pass' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readEntries().length, 1);
    assert.equal(judgeCallCount(), 1);
  });

  it('判卷 prompt 包含消息原文与七条标准', () => {
    run(['--action', 'to_human', '--from', 'arch', '--to', 'human', '--message', 'MARKER_MSG_XYZ'],
      { STUB_JUDGE_MODE: 'pass' });
    const logged = fs.readFileSync(stubLogPath, 'utf-8');
    assert.match(logged, /MARKER_MSG_XYZ/);
    assert.match(logged, /老板你定/);
    assert.match(logged, /-p/);
  });

  it('to_human + 判卷不过 → exit 1、不写入、stderr 列出未过项', () => {
    const res = run(['--action', 'to_human', '--from', 'arch', '--to', 'human', '--message', '你觉得呢'],
      { STUB_JUDGE_MODE: 'fail' });
    assert.equal(res.status, 1);
    assert.equal(readEntries().length, 0);
    assert.match(res.stderr, /判卷未通过/);
    assert.match(res.stderr, /④/);
    assert.match(res.stderr, /⑦/);
    assert.match(res.stderr, /重新调用本工具/);
  });

  it('非 to_human 不判卷', () => {
    const res = run(['--action', 'to_arch', '--from', 'dev', '--to', 'arch', '--message', '交付完成'],
      { STUB_JUDGE_MODE: 'fail' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readEntries().length, 1);
    assert.equal(judgeCallCount(), 0);
  });

  it('from=human 的 to_human 不判卷', () => {
    const res = run(['--action', 'to_human', '--from', 'human', '--to', 'human', '--message', '人类留言'],
      { STUB_JUDGE_MODE: 'fail' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readEntries().length, 1);
    assert.equal(judgeCallCount(), 0);
  });

  it('TEAM3_JUDGE_SKIP=1 跳过判卷', () => {
    const res = run(['--action', 'to_human', '--from', 'arch', '--to', 'human', '--message', 'msg'],
      { STUB_JUDGE_MODE: 'fail', TEAM3_JUDGE_SKIP: '1' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readEntries().length, 1);
    assert.equal(judgeCallCount(), 0);
  });

  it('判卷进程崩溃 → fail-open 照写并告警', () => {
    const res = run(['--action', 'to_human', '--from', 'arch', '--to', 'human', '--message', 'msg'],
      { STUB_JUDGE_MODE: 'crash' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readEntries().length, 1);
    assert.match(res.stderr, /判卷不可用/);
  });

  it('判卷输出不可解析 → fail-open 照写并告警', () => {
    const res = run(['--action', 'to_human', '--from', 'arch', '--to', 'human', '--message', 'msg'],
      { STUB_JUDGE_MODE: 'garbage' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readEntries().length, 1);
    assert.match(res.stderr, /判卷不可用/);
  });

  it('判卷 JSON 损坏但含 pass:false → 仍拒绝，不放行', () => {
    const res = run(['--action', 'to_human', '--from', 'arch', '--to', 'human', '--message', 'msg'],
      { STUB_JUDGE_MODE: 'broken-json-fail' });
    assert.equal(res.status, 1);
    assert.equal(readEntries().length, 0);
    assert.match(res.stderr, /判卷未通过/);
    assert.match(res.stderr, /JSON 损坏/);
  });

  it('判卷命令不存在 → fail-open 照写并告警', () => {
    const res = run(['--action', 'to_human', '--from', 'arch', '--to', 'human', '--message', 'msg'],
      { TEAM3_JUDGE_CMD: path.join(tmpDir, 'no-such-cmd') });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readEntries().length, 1);
    assert.match(res.stderr, /判卷不可用/);
  });

  it('原有字段校验不受影响：非法 action 仍 exit 1', () => {
    const res = run(['--action', 'bad_action', '--from', 'arch', '--to', 'human', '--message', 'msg']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--action 必须是/);
    assert.equal(readEntries().length, 0);
  });

  describe('agent 间消息长度门', () => {
    const longMsg = 'x'.repeat(501);

    it('agent→agent 超 500 字 → exit 1、不写入、提示细节进文件', () => {
      const res = run(['--action', 'to_arch', '--from', 'dev', '--to', 'arch', '--message', longMsg]);
      assert.equal(res.status, 1);
      assert.equal(readEntries().length, 0);
      assert.match(res.stderr, /硬限 500 字/);
      assert.match(res.stderr, /reread/);
      assert.equal(judgeCallCount(), 0);
    });

    it('agent→agent 恰好 500 字 → 写入成功', () => {
      const res = run(['--action', 'dev_do', '--from', 'arch', '--to', 'dev', '--message', 'x'.repeat(500)]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(readEntries().length, 1);
    });

    it('human 发的长消息不受限', () => {
      const res = run(['--action', 'to_arch', '--from', 'human', '--to', 'arch', '--message', longMsg]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(readEntries().length, 1);
    });

    it('note 长消息不受限', () => {
      const res = run(['--action', 'note', '--from', 'arch', '--to', '', '--message', longMsg]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(readEntries().length, 1);
    });

    it('to_human 长消息同样被长度门拦下，且不调判卷', () => {
      const res = run(['--action', 'to_human', '--from', 'arch', '--to', 'human', '--message', longMsg],
        { STUB_JUDGE_MODE: 'pass' });
      assert.equal(res.status, 1);
      assert.equal(readEntries().length, 0);
      assert.match(res.stderr, /硬限 500 字/);
      assert.equal(judgeCallCount(), 0);
    });

    it('TEAM3_AGENT_MSG_MAX 可覆盖上限', () => {
      const res = run(['--action', 'to_arch', '--from', 'dev', '--to', 'arch', '--message', 'x'.repeat(50)],
        { TEAM3_AGENT_MSG_MAX: '10' });
      assert.equal(res.status, 1);
      assert.match(res.stderr, /硬限 10 字/);
    });
  });

  describe('to_dev / to_uat 仅人类可发', () => {
    it('human 发 to_dev / to_uat → 写入成功', () => {
      for (const [action, to] of [['to_dev', 'dev'], ['to_uat', 'uat']]) {
        const res = run(['--action', action, '--from', 'human', '--to', to, '--message', '补充一句']);
        assert.equal(res.status, 0, res.stderr);
      }
      assert.equal(readEntries().length, 2);
      assert.equal(judgeCallCount(), 0);
    });

    it('agent 发 to_dev → exit 1、不写入、提示正确 action', () => {
      const res = run(['--action', 'to_dev', '--from', 'arch', '--to', 'dev', '--message', '改一下']);
      assert.equal(res.status, 1);
      assert.equal(readEntries().length, 0);
      assert.match(res.stderr, /仅人类可发/);
      assert.match(res.stderr, /dev_fix/);
    });

    it('agent 发 to_uat → exit 1、不写入', () => {
      const res = run(['--action', 'to_uat', '--from', 'uat', '--to', 'uat', '--message', 'self']);
      assert.equal(res.status, 1);
      assert.equal(readEntries().length, 0);
      assert.match(res.stderr, /仅人类可发/);
    });
  });
});
