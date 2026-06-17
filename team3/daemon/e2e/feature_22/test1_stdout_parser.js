'use strict';

/**
 * E2E Test: Feature #22 - Checkpoint Steps 1-4
 *
 * Step 1: stdout-parser.js parses real stream-json format correctly:
 *         assistant messages with message.content[] blocks (text/thinking/tool_use),
 *         returns null for system/user/result.
 * Step 2: Per-role line buffering handles partial lines (cross-chunk).
 * Step 3: WS broadcasts {type:'agent.log', role, lines:[...]} on parsed output.
 * Step 4: Unit tests cover all scenarios (verified by npm test).
 *
 * Uses real DaemonOrchestrator with mock spawn emitting real-format
 * stream-json stdout, plus a real WebSocket client to verify WS broadcast.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const EventEmitter = require('events');

const DaemonOrchestrator = require('../../src/daemon-orchestrator');

/**
 * Build a real-format stream-json assistant line.
 */
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
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    session_id: 'test-session',
  });
}

describe('E2E: stdout stream-json parse + WS broadcast (Feature #22)', () => {
  let tmpDir;
  let actionsFile;
  let projectJsonPath;
  let orchestrator;
  let wsClient;
  const PORT = 13422; // Unique port

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature22-test1-'));
    actionsFile = path.join(tmpDir, 'spec', 'actions.jsonl');
    projectJsonPath = path.join(tmpDir, '.team3-project.json');

    // Setup directory structure
    fs.mkdirSync(path.join(tmpDir, 'spec', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'logs'), { recursive: true });
    fs.writeFileSync(actionsFile, '');
    fs.writeFileSync(projectJsonPath, JSON.stringify({
      name: 'test-feature22',
      partner: {
        arch_agent: { session: { runing: 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } },
        dev_agent: { session: { runing: '1111-2222-3333-4444-555555555555', done: [] } },
        uat_agent: { session: { runing: 'ffff-0000-1111-2222-333333333333' } },
      }
    }, null, 2));
    fs.writeFileSync(path.join(tmpDir, 'spec', 'agents', 'arch_prompt.md'), '# Arch');
    fs.writeFileSync(path.join(tmpDir, 'spec', 'agents', 'dev_prompt.md'), '# Dev');
    fs.writeFileSync(path.join(tmpDir, 'spec', 'agents', 'uat_prompt.md'), '# UAT');
  });

  after(async () => {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.close();
    }
    if (orchestrator && orchestrator.isRunning) {
      await orchestrator.stop();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 1: should parse real-format text/thinking/tool_use and skip system/result', async () => {
    const { parseStreamJsonLine } = require('../../src/stdout-parser');

    // assistant/text (real format: message.content[].text)
    const textResult = parseStreamJsonLine(assistantLine(
      { type: 'text', text: 'Feature #22 implemented successfully ✓' }
    ));
    assert.ok(textResult);
    assert.equal(textResult.length, 1);
    assert.ok(textResult[0].content.includes('Feature #22'));
    assert.equal(textResult[0].tone, 'success');

    // assistant/thinking (real format: message.content[].thinking, NOT .text)
    const thinkResult = parseStreamJsonLine(assistantLine(
      { type: 'thinking', thinking: 'Let me analyze the code structure...', signature: 'Eq8D...' }
    ));
    assert.ok(thinkResult);
    assert.ok(thinkResult[0].content.startsWith('[思考]'));
    assert.ok(thinkResult[0].content.includes('analyze the code'));

    // assistant/tool_use (real format: message.content[].name + .input)
    const toolResult = parseStreamJsonLine(assistantLine(
      { type: 'tool_use', id: 'toolu_test', name: 'Read', input: { file_path: '/src/daemon.js' } }
    ));
    assert.ok(toolResult);
    assert.equal(toolResult[0].content, 'Read /src/daemon.js');
    assert.equal(toolResult[0].tone, 'route');

    // assistant/tool_use with command
    const bashResult = parseStreamJsonLine(assistantLine(
      { type: 'tool_use', id: 'toolu_test2', name: 'Bash', input: { command: 'npm test' } }
    ));
    assert.ok(bashResult);
    assert.equal(bashResult[0].content, 'Bash npm test');

    // system → null
    assert.equal(parseStreamJsonLine(JSON.stringify({
      type: 'system', subtype: 'init', session_id: 'x', cwd: '/some/path',
    })), null);

    // user → null
    assert.equal(parseStreamJsonLine(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'output' }] },
    })), null);

    // result → null
    assert.equal(parseStreamJsonLine(JSON.stringify({
      type: 'result', subtype: 'success', result: 'done', is_error: false,
    })), null);

    // Truncation: long content gets truncated to 500 chars + '...'
    const longText = 'x'.repeat(600);
    const longResult = parseStreamJsonLine(assistantLine(
      { type: 'text', text: longText }
    ));
    assert.ok(longResult);
    assert.equal(longResult[0].content.length, 503); // 500 + '...'
  });

  it('Steps 2 & 3: line buffering + WS broadcast agent.log (real format)', async () => {
    // Build real-format stream-json lines
    const systemLine = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'test', cwd: tmpDir });
    const textLine = assistantLine({ type: 'text', text: 'Hello from arch agent' });
    const thinkLine = assistantLine({ type: 'thinking', thinking: 'Analyzing requirements...', signature: 'abc' });
    const toolLine = assistantLine({ type: 'tool_use', id: 'toolu_x', name: 'Read', input: { file_path: '/src/app.js' } });
    const resultLine = JSON.stringify({ type: 'result', subtype: 'success', result: 'completed', is_error: false });

    // Create orchestrator with mock spawn emitting these lines
    orchestrator = new DaemonOrchestrator({
      port: PORT,
      projectJsonPath,
      actionsFilePath: actionsFile,
      workspaceDir: tmpDir,
      stateFilePath: path.join(tmpDir, '.daemon-state.json'),
      healthCheckInterval: 0, // disable health check
      spawnFn: (cmd, args, opts) => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.stdin = { write: () => {}, end: () => {} };
        proc.pid = process.pid;
        proc.kill = () => {};

        setTimeout(() => {
          // Chunk 1: system (full) + partial text (split at position 30)
          const chunk1 = systemLine + '\n' + textLine.substring(0, 30);
          proc.stdout.emit('data', Buffer.from(chunk1));

          // Chunk 2: rest of text + thinking + tool_use + result
          setTimeout(() => {
            const chunk2 = textLine.substring(30) + '\n' + thinkLine + '\n' + toolLine + '\n' + resultLine + '\n';
            proc.stdout.emit('data', Buffer.from(chunk2));

            setTimeout(() => proc.emit('close', 0), 20);
          }, 20);
        }, 10);

        return proc;
      },
    });

    await orchestrator.start();

    // Connect WS client
    wsClient = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((resolve) => {
      wsClient.on('message', function onMsg(data) {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connected') {
          wsClient.removeListener('message', onMsg);
          resolve();
        }
      });
    });

    // Collect agent.log events from WS
    const agentLogs = [];
    wsClient.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'agent.log') {
          agentLogs.push(msg);
        }
        // Non-agent.log messages are silently ignored — no error
      } catch (e) {
        // Ignore non-JSON
      }
    });

    // Trigger: write a to_arch action to actionsFile
    const action = {
      action: 'to_arch',
      from: 'dev',
      to: 'arch',
      ts: Math.floor(Date.now() / 1000),
      message: 'test agent.log broadcast',
    };
    fs.appendFileSync(actionsFile, JSON.stringify(action) + '\n');

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify: agent.log events received via WS
    assert.ok(agentLogs.length > 0, `Expected at least 1 agent.log event, got ${agentLogs.length}`);

    // All events should have correct structure
    for (const logEvent of agentLogs) {
      assert.equal(logEvent.type, 'agent.log');
      assert.equal(logEvent.role, 'arch');
      assert.ok(Array.isArray(logEvent.lines));
      for (const line of logEvent.lines) {
        assert.ok(typeof line.content === 'string', `content should be string, got ${typeof line.content}`);
        if (line.tone) {
          assert.ok(['success', 'mention', 'route'].includes(line.tone), `unexpected tone: ${line.tone}`);
        }
      }
    }

    // Collect all parsed lines across events
    const allLines = agentLogs.flatMap(e => e.lines);

    // Should contain text, thinking, tool_use results (not system/result)
    const textLines = allLines.filter(l => l.content.includes('Hello from arch'));
    assert.ok(textLines.length >= 1, 'Should have text line about "Hello from arch"');

    const thinkLines = allLines.filter(l => l.content.startsWith('[思考]'));
    assert.ok(thinkLines.length >= 1, 'Should have thinking line with [思考] prefix');

    const toolLines = allLines.filter(l => l.tone === 'route');
    assert.ok(toolLines.length >= 1, 'Should have tool_use line with tone=route');
    assert.ok(toolLines[0].content.includes('Read'), 'Tool line should mention Read');
    assert.ok(toolLines[0].content.includes('/src/app.js'), 'Tool line should mention file path');

    // system/result should NOT appear
    const systemLines = allLines.filter(l => l.content.includes('init') && l.content.includes('system'));
    assert.equal(systemLines.length, 0, 'system events should be skipped');

    // Stop orchestrator
    await orchestrator.stop();
    orchestrator = null;
  });
});
