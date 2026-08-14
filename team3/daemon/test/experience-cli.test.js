'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CLI_PATH = path.resolve(__dirname, '../../cli/experience.mjs');

// experience.md 是普通 markdown，三角色直接追加；cli 只读（list/show）
describe('experience.mjs CLI (read-only over spec/experience.md)', () => {
  let tmpDir;
  let mdPath;

  function run(args) {
    return spawnSync('node', [CLI_PATH, ...args, '--file', mdPath], { encoding: 'utf-8' });
  }

  function writeEntries(text) {
    fs.mkdirSync(path.dirname(mdPath), { recursive: true });
    fs.writeFileSync(mdPath, text, 'utf-8');
  }

  const SAMPLE = [
    '# Agent 经验库',
    '',
    '## 2026-07-20 | dev | e2e 前必须先起服务再跑用例',
    '- 问题: 直接跑用例导致连接拒绝',
    '- 原因: 服务未就绪',
    '- 应该咋做: 先启动并等健康检查通过再跑',
    '- ref: spec/actions.jsonl #123',
    '',
    '## 2026-07-21 | uat | 真实浏览器验证要处理字体 404',
    '- 问题: 离线环境远程字体 404 报 console error',
    '- 原因: @import 了 Google Fonts',
    '- 应该咋做: 验证前排除已知无害 console error',
    '- ref: game_loopit uat 记录',
    '',
  ].join('\n');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-test-'));
    mdPath = path.join(tmpDir, 'spec', 'experience.md');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('list', () => {
    it('prints one indexed header line per entry', () => {
      writeEntries(SAMPLE);
      const res = run(['list']);
      assert.equal(res.status, 0, res.stderr);
      const lines = res.stdout.trim().split('\n');
      assert.equal(lines.length, 2);
      assert.equal(lines[0], '#1 | 2026-07-20 | dev | e2e 前必须先起服务再跑用例');
      assert.equal(lines[1], '#2 | 2026-07-21 | uat | 真实浏览器验证要处理字体 404');
    });

    it('handles missing file as empty library', () => {
      const res = run(['list']);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /经验库为空/);
    });

    it('ignores non-entry lines (title, prose) instead of crashing', () => {
      writeEntries('# 随便的标题\n\n乱写的一行\n\n' + SAMPLE);
      const res = run(['list']);
      assert.equal(res.status, 0);
      assert.equal(res.stdout.trim().split('\n').length, 2);
    });
  });

  describe('show', () => {
    it('prints the full entry body', () => {
      writeEntries(SAMPLE);
      const res = run(['show', '1']);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /#1 \| 2026-07-20 \| dev \| e2e 前必须先起服务再跑用例/);
      assert.match(res.stdout, /- 问题: 直接跑用例导致连接拒绝/);
      assert.match(res.stdout, /- 原因: 服务未就绪/);
      assert.match(res.stdout, /- 应该咋做: 先启动并等健康检查通过再跑/);
      assert.match(res.stdout, /- ref: spec\/actions\.jsonl #123/);
      // 不包含第二条的内容
      assert.ok(!res.stdout.includes('字体 404'));
    });

    it('accepts #-prefixed id', () => {
      writeEntries(SAMPLE);
      const res = run(['show', '#2']);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /真实浏览器验证要处理字体 404/);
    });

    it('errors on unknown id', () => {
      writeEntries(SAMPLE);
      const res = run(['show', '99']);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, /没有找到 #99/);
    });

    it('errors when id missing', () => {
      writeEntries(SAMPLE);
      const res = run(['show']);
      assert.notEqual(res.status, 0);
      assert.match(res.stderr, /show 需要指定序号/);
    });
  });

  it('rejects unknown command with usage (add is no longer a command)', () => {
    const res = run(['add', '--role', 'dev']);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /写入不走本工具/);
  });
});
