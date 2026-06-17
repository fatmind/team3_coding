'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ProjectJson = require('../src/project-json');

describe('ProjectJson', () => {
  let tmpDir;
  let tmpFile;
  let projectJson;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team3-test-'));
    tmpFile = path.join(tmpDir, '.team3-project.json');
    projectJson = new ProjectJson(tmpFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('read()', () => {
    it('should create file with empty object if not exists', () => {
      const data = projectJson.read();
      assert.deepStrictEqual(data, {});
      assert.ok(fs.existsSync(tmpFile));
    });

    it('should read existing valid JSON', () => {
      const content = { name: 'test-project', init_daemon: 12345 };
      fs.writeFileSync(tmpFile, JSON.stringify(content));
      const data = projectJson.read();
      assert.deepStrictEqual(data, content);
    });

    it('should throw on invalid JSON', () => {
      fs.writeFileSync(tmpFile, 'not json{{{');
      assert.throws(() => projectJson.read(), { name: 'SyntaxError' });
    });
  });

  describe('write()', () => {
    it('should write data as formatted JSON', () => {
      const data = { name: 'test', version: '1.0' };
      projectJson.write(data);
      const raw = fs.readFileSync(tmpFile, 'utf-8');
      assert.strictEqual(raw, JSON.stringify(data, null, 2) + '\n');
    });

    it('should create parent directories if needed', () => {
      const nestedFile = path.join(tmpDir, 'sub', 'dir', '.team3-project.json');
      const pj = new ProjectJson(nestedFile);
      pj.write({ test: true });
      assert.ok(fs.existsSync(nestedFile));
    });
  });

  describe('update()', () => {
    it('should merge fields into existing data', () => {
      fs.writeFileSync(tmpFile, JSON.stringify({ name: 'proj', version: '1.0' }));
      const result = projectJson.update({ init_daemon: 9999 });
      assert.deepStrictEqual(result, { name: 'proj', version: '1.0', init_daemon: 9999 });
    });

    it('should overwrite existing fields', () => {
      fs.writeFileSync(tmpFile, JSON.stringify({ init_daemon: 111 }));
      const result = projectJson.update({ init_daemon: 222 });
      assert.strictEqual(result.init_daemon, 222);
    });

    it('should create file if not exists and set fields', () => {
      const result = projectJson.update({ daemon_heart: '2026-05-24T00:00:00Z' });
      assert.strictEqual(result.daemon_heart, '2026-05-24T00:00:00Z');
    });
  });
});
