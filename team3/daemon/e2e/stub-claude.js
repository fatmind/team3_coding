#!/usr/bin/env node
'use strict';

/**
 * stub-claude.js - Simulates claude CLI for e2e testing
 *
 * Feature #9: Replaces mock spawn functions with a real spawnable script.
 *
 * Accepts the same flags as real claude code:
 *   -p <prompt>
 *   --session-id <uuid>
 *   --resume <uuid>
 *   --system-prompt-file <path>
 *   --output-format stream-json
 *   --verbose
 *
 * Behavior:
 * 1. Parses and validates all arguments
 * 2. Checks UUID format validity
 * 3. Checks system-prompt-file existence
 * 4. If prompt contains "写 actions.jsonl" or "追加" → simulates arch writing to actions.jsonl
 * 5. Outputs stream-json formatted result to stdout
 * 6. Exits with code 0 (success)
 *
 * Environment variables:
 *   STUB_CLAUDE_DELAY_MS - Delay before exit (default: 50ms, for testing queue behavior)
 *   STUB_CLAUDE_EXIT_CODE - Override exit code (default: 0)
 *   STUB_CLAUDE_ACTIONS_PATH - Path to actions.jsonl for arch simulation
 *   STUB_CLAUDE_LOG_PATH - If set, log received args to this file
 *   STUB_CLAUDE_AUTO_RESPOND - If "true", always write a response to actions.jsonl
 *                              (role inferred from --system-prompt-file path)
 */

const fs = require('fs');
const path = require('path');

// Parse command-line arguments
function parseArgs(argv) {
  const args = argv.slice(2); // skip node and script path
  const parsed = {
    prompt: null,
    sessionId: null,
    resume: null,
    systemPromptFile: null,
    outputFormat: null,
    verbose: false,
  };
  const errors = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-p':
        parsed.prompt = args[++i];
        break;
      case '--session-id':
        parsed.sessionId = args[++i];
        break;
      case '--resume':
        parsed.resume = args[++i];
        break;
      case '--system-prompt-file':
        parsed.systemPromptFile = args[++i];
        break;
      case '--system-prompt':
        parsed.systemPrompt = args[++i];
        break;
      case '--output-format':
        parsed.outputFormat = args[++i];
        break;
      case '--verbose':
        parsed.verbose = true;
        break;
      default:
        // Unknown arg, ignore
        break;
    }
  }

  return { parsed, errors };
}

// Validate UUID v4 format
function isValidUUID(str) {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Main
function main() {
  const { parsed } = parseArgs(process.argv);
  const delay = parseInt(process.env.STUB_CLAUDE_DELAY_MS || '50', 10);
  const exitCode = parseInt(process.env.STUB_CLAUDE_EXIT_CODE || '0', 10);
  const actionsPath = process.env.STUB_CLAUDE_ACTIONS_PATH || null;
  const logPath = process.env.STUB_CLAUDE_LOG_PATH || null;

  // Log received args if requested
  if (logPath) {
    const logEntry = {
      ts: Date.now(),
      args: parsed,
      raw: process.argv.slice(2),
    };
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  }

  // Validate arguments
  const validationResults = [];

  // Must have -p
  if (!parsed.prompt) {
    validationResults.push({ field: 'prompt', status: 'missing' });
  } else {
    validationResults.push({ field: 'prompt', status: 'ok', length: parsed.prompt.length });
  }

  // Must have either --session-id or --resume (not both)
  if (parsed.sessionId && parsed.resume) {
    validationResults.push({ field: 'session', status: 'error', reason: 'both --session-id and --resume provided' });
  } else if (parsed.sessionId) {
    if (!isValidUUID(parsed.sessionId)) {
      process.stderr.write(`Invalid session ID. Must be a valid UUID.\n`);
      process.exit(1);
    }
    validationResults.push({ field: 'session-id', status: 'ok', value: parsed.sessionId });
  } else if (parsed.resume) {
    if (!isValidUUID(parsed.resume)) {
      process.stderr.write(`Invalid session ID. Must be a valid UUID.\n`);
      process.exit(1);
    }
    validationResults.push({ field: 'resume', status: 'ok', value: parsed.resume });
  } else {
    validationResults.push({ field: 'session', status: 'missing', reason: 'need --session-id or --resume' });
  }

  // System prompt (inline or file)
  if (parsed.systemPrompt) {
    validationResults.push({ field: 'system-prompt', status: 'ok' });
  } else if (parsed.systemPromptFile) {
    if (fs.existsSync(parsed.systemPromptFile)) {
      validationResults.push({ field: 'system-prompt-file', status: 'ok', path: parsed.systemPromptFile });
    } else {
      validationResults.push({ field: 'system-prompt-file', status: 'warning', reason: 'file not found', path: parsed.systemPromptFile });
    }
  }

  // Output format
  if (parsed.outputFormat === 'stream-json') {
    validationResults.push({ field: 'output-format', status: 'ok' });
  }

  // Infer role from system-prompt content or file path
  function inferRole() {
    if (parsed.systemPrompt) {
      if (parsed.systemPrompt.includes('ARCHITECT')) return 'arch';
      if (parsed.systemPrompt.includes('DEV')) return 'dev';
      if (parsed.systemPrompt.includes('UAT')) return 'uat';
      return 'arch';
    }
    if (!parsed.systemPromptFile) return 'arch';
    const basename = path.basename(parsed.systemPromptFile);
    if (basename.startsWith('arch')) return 'arch';
    if (basename.startsWith('dev')) return 'dev';
    if (basename.startsWith('uat')) return 'uat';
    return 'arch';
  }

  // Simulate arch behavior: if prompt asks to write actions.jsonl
  if (parsed.prompt && actionsPath &&
      (parsed.prompt.includes('actions.jsonl') || parsed.prompt.includes('追加'))) {
    // Simulate arch writing notification to actions.jsonl
    const action = {
      action: 'to_human',
      from: 'arch',
      to: 'human',
      ts: Math.floor(Date.now() / 1000),
      message: 'arch 已在线，我们开始讨论吧',
    };
    fs.appendFileSync(actionsPath, JSON.stringify(action) + '\n');
  }

  // Auto-respond mode: always write a response to actions.jsonl
  // regardless of prompt content (for roundtrip e2e testing)
  const autoRespond = process.env.STUB_CLAUDE_AUTO_RESPOND === 'true';
  if (autoRespond && actionsPath) {
    const role = inferRole();
    const responseAction = {
      action: 'to_human',
      from: role,
      to: 'human',
      ts: Math.floor(Date.now() / 1000),
      message: `[${role}] 收到消息，已处理完毕: ${(parsed.prompt || '').slice(0, 100)}`,
    };
    fs.appendFileSync(actionsPath, JSON.stringify(responseAction) + '\n');
  }

  // Output stream-json result after delay
  setTimeout(() => {
    // Emit init message
    const initMsg = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: parsed.sessionId || parsed.resume || 'unknown',
    });
    process.stdout.write(initMsg + '\n');

    // Emit result message
    const resultMsg = JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: parsed.sessionId || parsed.resume || 'unknown',
      validation: validationResults,
      cost_usd: 0,
      duration_ms: delay,
      is_error: false,
      num_turns: 1,
    });
    process.stdout.write(resultMsg + '\n');

    process.exit(exitCode);
  }, delay);
}

main();
