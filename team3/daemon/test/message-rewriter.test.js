'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  rewriteMessage,
  applyRereadRule,
  getInProgressModuleId,
  REREAD_REGEX,
} = require('../src/message-rewriter');

describe('MessageRewriter', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-rewriter-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('REREAD_REGEX', () => {
    it('should match [reread: ...] at end of string', () => {
      const msg = 'hello world [reread: spec/module_1.md, spec/module_1_feature_list.json]';
      const match = msg.match(REREAD_REGEX);
      assert.ok(match);
      assert.equal(match[1], 'spec/module_1.md, spec/module_1_feature_list.json');
    });

    it('should match with trailing whitespace', () => {
      const msg = 'hello [reread: spec/a.md]  ';
      const match = msg.match(REREAD_REGEX);
      assert.ok(match);
    });

    it('should not match if reread is not at end', () => {
      const msg = '[reread: spec/a.md] and more text';
      const match = msg.match(REREAD_REGEX);
      assert.equal(match, null);
    });

    it('should match single file', () => {
      const msg = 'msg [reread: spec/module_3.md]';
      const match = msg.match(REREAD_REGEX);
      assert.ok(match);
      assert.equal(match[1], 'spec/module_3.md');
    });
  });

  describe('applyRereadRule', () => {
    const msgWithReread = '请实现 Feature #4 [reread: spec/module_1.md, spec/module_1_feature_list.json]';

    // Checkpoint Step 3: to=arch or to=dev → keep reread unchanged
    it('should keep reread unchanged for to=arch', () => {
      const result = applyRereadRule(msgWithReread, 'arch');
      assert.equal(result, msgWithReread);
    });

    it('should keep reread unchanged for to=dev', () => {
      const result = applyRereadRule(msgWithReread, 'dev');
      assert.equal(result, msgWithReread);
    });

    // Checkpoint Step 1: to=human → strip reread entirely
    it('should strip reread entirely for to=human', () => {
      const result = applyRereadRule(msgWithReread, 'human');
      assert.equal(result, '请实现 Feature #4');
    });

    // Checkpoint Step 2: to=uat → filter feature_list and progress files
    it('should filter feature_list.json and progress.txt from reread for to=uat', () => {
      const msg = 'msg [reread: spec/module_1.md, spec/module_1_feature_list.json, spec/module_1_progress.txt]';
      const result = applyRereadRule(msg, 'uat');
      assert.equal(result, 'msg [reread: spec/module_1.md]');
    });

    it('should remove entire reread if all files filtered for to=uat', () => {
      const msg = 'msg [reread: spec/module_1_feature_list.json, spec/module_1_progress.txt]';
      const result = applyRereadRule(msg, 'uat');
      assert.equal(result, 'msg');
    });

    it('should keep non-filtered files for to=uat', () => {
      const msg = 'msg [reread: spec/module_1.md, spec/decision_log.md, spec/module_1_feature_list.json]';
      const result = applyRereadRule(msg, 'uat');
      assert.equal(result, 'msg [reread: spec/module_1.md, spec/decision_log.md]');
    });

    it('should handle message without reread', () => {
      const msg = 'plain message without reread';
      assert.equal(applyRereadRule(msg, 'human'), msg);
      assert.equal(applyRereadRule(msg, 'uat'), msg);
      assert.equal(applyRereadRule(msg, 'arch'), msg);
      assert.equal(applyRereadRule(msg, 'dev'), msg);
    });

    it('should handle reread with modules_progress.json for uat', () => {
      const msg = 'msg [reread: spec/modules_progress.json, spec/module_3.md]';
      const result = applyRereadRule(msg, 'uat');
      // modules_progress.json doesn't match the filter patterns, so kept
      assert.equal(result, 'msg [reread: spec/modules_progress.json, spec/module_3.md]');
    });
  });

  describe('getInProgressModuleId', () => {
    it('should return id of in_progress module', () => {
      const filePath = path.join(tmpDir, 'modules_progress.json');
      fs.writeFileSync(filePath, JSON.stringify({
        modules: [
          { id: 'module_1', status: 'done' },
          { id: 'module_2', status: 'in_progress' },
        ],
      }));
      assert.equal(getInProgressModuleId(filePath), 'module_2');
    });

    it('should return null if modules array empty', () => {
      const filePath = path.join(tmpDir, 'modules_progress.json');
      fs.writeFileSync(filePath, JSON.stringify({ modules: [] }));
      assert.equal(getInProgressModuleId(filePath), null);
    });

    it('should return null if file missing', () => {
      assert.equal(getInProgressModuleId(path.join(tmpDir, 'missing.json')), null);
    });
  });

  describe('rewriteMessage (combined)', () => {
    it('to=human: strip reread', () => {
      const msg = '验收通过 [reread: spec/module_1.md, spec/module_1_feature_list.json]';
      const result = rewriteMessage(msg, 'human');
      assert.equal(result, '验收通过');
      assert.ok(!result.includes('[reread:'));
    });

    it('to=arch: keep reread', () => {
      const msg = '交付完成 [reread: spec/module_1.md, spec/module_1_feature_list.json]';
      const result = rewriteMessage(msg, 'arch');
      assert.equal(result, msg);
    });

    it('to=dev: keep reread unchanged', () => {
      const msg = '请实现 Feature #4 [reread: spec/module_3_feature_list.json, spec/module_3_progress.txt]';
      const result = rewriteMessage(msg, 'dev');
      assert.equal(result, msg);
    });

    it('to=uat: filter reread', () => {
      const msg = '请验证 [reread: spec/module_1.md, spec/module_1_feature_list.json, spec/module_1_progress.txt]';
      const result = rewriteMessage(msg, 'uat');
      assert.equal(result, '请验证 [reread: spec/module_1.md]');
    });

    it('to=uat: all reread files filtered', () => {
      const msg = '验证 [reread: spec/module_1_feature_list.json]';
      const result = rewriteMessage(msg, 'uat');
      assert.equal(result, '验证');
    });

    it('message without reread: to=dev unchanged', () => {
      const msg = 'plain task description';
      const result = rewriteMessage(msg, 'dev');
      assert.equal(result, 'plain task description');
    });

    it('message without reread: to=human unchanged', () => {
      const msg = 'plain notification';
      const result = rewriteMessage(msg, 'human');
      assert.equal(result, 'plain notification');
    });
  });
});
