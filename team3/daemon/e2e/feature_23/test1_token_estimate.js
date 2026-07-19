'use strict';

/**
 * E2E Test: Token Estimation (spec/token_money.md §4.1)
 *
 * Verifies that the daemon enriches result events in agent logs with
 * estimated token counts derived from char-level accumulation during
 * stream-json processing.
 *
 * Uses DaemonOrchestrator with mock spawn emitting realistic stream-json
 * events (system, user, assistant with thinking/redacted_thinking/text/tool_use,
 * tool_result, result). After the session completes, reads the agent log file
 * and asserts:
 *   - result event has non-zero usage.input_tokens / output_tokens
 *   - result event has _token_estimate with correct char breakdowns
 *   - turns count matches the number of assistant events emitted
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const EventEmitter = require('events');

const DaemonOrchestrator = require('../../src/daemon-orchestrator');

function buildLine(type, payload) {
  return JSON.stringify({ type, ...payload });
}

function assistantLine(blocks) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      model: 'claude-opus-4-6',
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: Array.isArray(blocks) ? blocks : [blocks],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    session_id: 'test-session',
  });
}

describe('E2E: Token estimation in agent logs (§4.1)', () => {
  let tmpDir;
  let actionsFile;
  let projectJsonPath;
  let logDir;
  let orchestrator;
  const PORT = 13423;

  const THINKING_TEXT = 'Let me analyze the project structure and understand what needs to be done here...';
  const REDACTED_DATA = 'VGhpcyBpcyBlbmNyeXB0ZWQgdGhpbmtpbmcgZGF0YSB0aGF0IHlvdSBjYW5ub3QgcmVhZA==';
  const TEXT_CONTENT = 'I will implement Feature #1 by creating the necessary files.';
  const TOOL_INPUT = { file_path: '/src/app.js', description: 'Read the main application file' };
  const TOOL_RESULT_CONTENT = 'const express = require("express"); const app = express(); module.exports = app;';

  const systemEvent = buildLine('system', { subtype: 'init', session_id: 'test-session', cwd: '/test' });
  const userEvent = buildLine('user', { message: { role: 'user', content: [{ type: 'text', text: 'Please implement Feature #1' }] } });

  const assistantThinking = assistantLine([
    { type: 'thinking', thinking: THINKING_TEXT, signature: 'abc123' },
    { type: 'redacted_thinking', data: REDACTED_DATA },
  ]);

  const assistantText = assistantLine([
    { type: 'text', text: TEXT_CONTENT },
  ]);

  const assistantToolUse = assistantLine([
    { type: 'tool_use', id: 'toolu_1', name: 'Read', input: TOOL_INPUT },
  ]);

  const toolResultEvent = buildLine('tool_result', { content: TOOL_RESULT_CONTENT });

  const resultEvent = buildLine('result', {
    subtype: 'success',
    session_id: 'test-session',
    result: 'done',
    is_error: false,
    cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
  });

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-est-e2e-'));
    actionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');
    logDir = path.join(tmpDir, 'logs');

    fs.mkdirSync(path.join(tmpDir, 'spec'), { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(actionsFile, '');
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      name: 'test-token-est',
      partner: {
        arch_agent: { session: { runing: null } },
        dev_agent: { session: { runing: null, done: [] } },
        uat_agent: { session: { runing: null } },
      },
    }));
  });

  after(async () => {
    if (orchestrator && orchestrator.isRunning) {
      await orchestrator.stop();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('result event in log should have estimated token counts and _token_estimate', async () => {
    orchestrator = new DaemonOrchestrator({
      port: PORT,
      projectJsonPath,
      actionsFilePath: actionsFile,
      workspaceDir: tmpDir,
      stateFilePath: path.join(tmpDir, '.daemon-state.json'),
      healthCheckInterval: 0,
      spawnFn: (cmd, args, opts) => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.stdin = { write: () => {}, end: () => {} };
        proc.pid = process.pid;
        proc.kill = () => {};

        setTimeout(() => {
          // Emit events in realistic order
          const allLines = [
            systemEvent,
            userEvent,
            assistantThinking,
            assistantText,
            assistantToolUse,
            toolResultEvent,
            resultEvent,
          ].join('\n') + '\n';

          proc.stdout.emit('data', Buffer.from(allLines));
          setTimeout(() => proc.emit('close', 0), 30);
        }, 20);

        return proc;
      },
    });

    await orchestrator.start();

    // Wait for WS to be ready
    const wsClient = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((resolve) => {
      wsClient.on('message', function onMsg(data) {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connected') {
          wsClient.removeListener('message', onMsg);
          resolve();
        }
      });
    });

    // Trigger: dispatch to_arch
    const completedPromise = new Promise((resolve, reject) => {
      orchestrator.on('completed', resolve);
      setTimeout(() => reject(new Error('Timeout waiting for completed')), 10_000);
    });

    const action = {
      action: 'to_arch',
      from: 'human',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: 'test token estimation',
    };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');

    await completedPromise;

    // Wait for log stream to flush
    orchestrator.agentScheduler.agentLogger.closeAll();
    await new Promise(r => setTimeout(r, 300));

    // Read the arch log file
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const logPath = path.join(logDir, `arch_${dateStr}.log`);

    assert.ok(fs.existsSync(logPath), `Log file should exist: ${logPath}`);

    const logContent = fs.readFileSync(logPath, 'utf-8');
    const logLines = logContent.trim().split('\n').filter(l => l.trim());

    // Find the result line
    const resultLines = [];
    for (const line of logLines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'result') resultLines.push(parsed);
      } catch (e) { /* skip non-JSON */ }
    }

    assert.ok(resultLines.length >= 1, `Should have at least 1 result line, got ${resultLines.length}`);

    // There should be exactly ONE result line (enriched in-memory before write)
    assert.equal(resultLines.length, 1, 'Should have exactly 1 result line (enriched, not duplicated)');

    const result = resultLines[0];

    // usage should have non-zero estimated values
    assert.ok(result.usage, 'result should have usage field');
    assert.ok(result.usage.input_tokens > 0, `input_tokens should be > 0, got ${result.usage.input_tokens}`);
    assert.ok(result.usage.output_tokens > 0, `output_tokens should be > 0, got ${result.usage.output_tokens}`);

    // _token_estimate should exist with correct structure
    assert.ok(result._token_estimate, 'result should have _token_estimate');
    const est = result._token_estimate;

    assert.ok(est.input_chars > 0, 'input_chars should be > 0');
    assert.ok(est.output_chars > 0, 'output_chars should be > 0');
    assert.ok(est.thinking_chars > 0, 'thinking_chars should be > 0');
    assert.ok(est.tool_result_chars > 0, 'tool_result_chars should be > 0');

    // Verify char counts are plausible
    // input_chars should include system + user line lengths
    assert.ok(est.input_chars >= systemEvent.length + userEvent.length,
      `input_chars (${est.input_chars}) should >= system+user lines (${systemEvent.length + userEvent.length})`);

    // thinking_chars should include thinking text + redacted data
    assert.ok(est.thinking_chars >= THINKING_TEXT.length + REDACTED_DATA.length,
      `thinking_chars (${est.thinking_chars}) should >= thinking+redacted (${THINKING_TEXT.length + REDACTED_DATA.length})`);

    // output_chars should include text content + tool_use input
    const toolInputLen = JSON.stringify(TOOL_INPUT).length;
    assert.ok(est.output_chars >= TEXT_CONTENT.length + toolInputLen,
      `output_chars (${est.output_chars}) should >= text+tool (${TEXT_CONTENT.length + toolInputLen})`);

    // tool_result_chars should include tool_result line
    assert.ok(est.tool_result_chars >= toolResultEvent.length,
      `tool_result_chars (${est.tool_result_chars}) should >= tool_result line (${toolResultEvent.length})`);

    // turns should be 3 (three assistant events)
    assert.equal(est.turns, 3, 'Should have 3 turns (3 assistant events)');

    // duration_s should be >= 0
    assert.ok(est.duration_s >= 0, 'duration_s should be >= 0');

    // usage.input_tokens should be roughly input_chars / 4
    assert.equal(result.usage.input_tokens, Math.round(est.input_chars / 4),
      'input_tokens should be input_chars / 4');
    assert.equal(result.usage.output_tokens, Math.round((est.output_chars + est.thinking_chars) / 4),
      'output_tokens should be (output_chars + thinking_chars) / 4');

    wsClient.close();
    await orchestrator.stop();
    orchestrator = null;
  });
});
