// logger.mjs — UAT 统一日志，写入 <workspace>/logs/uat.log
//
// 用法：
//   import { createLogger } from './logger.mjs';
//   const log = createLogger('/abs/path/to/workspace');
//   log('SCENE 1', '创建活动并初始化');
//   log('UI', 'type "阳光馆" into input#venue');
//   log('WAIT', 'polling actions.jsonl for arch reply...');
//   log('FAIL', 'scene3: expected reply, got nothing after 300s');

import fs from 'node:fs';
import path from 'node:path';

export function createLogger(workspace) {
  const logDir = path.join(workspace, 'logs');
  const logPath = path.join(logDir, 'uat.log');

  fs.mkdirSync(logDir, { recursive: true });

  function log(tag, msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${tag}] ${msg}\n`;
    fs.appendFileSync(logPath, line);
    process.stdout.write(line);
  }

  log.path = logPath;
  return log;
}
