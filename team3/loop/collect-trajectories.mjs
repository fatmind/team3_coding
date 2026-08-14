// collect-trajectories.mjs — 把 team3 单趟回归里各角色的 Agent 会话轨迹打包成 zip
//
// 背景：team3 一趟回归会 spawn 很多独立 session（arch/dev/uat 各若干），
// 会话 id 记在 workspace 的 .team3-project.json（partner.<role>.session.runing + done[]）。
// 会话原始 jsonl 存在各 CLI 自己的隐藏目录：qodercli→~/.qoder，qoderclicn→~/.qoder-cn。
// 复用已安装的 export-session skill（scripts/export.py）逐个导出（含段日志 + 百炼 requestId）。
//
// 关键点：export.py 写死只读 ~/.qoder。要导 CN(qoderclicn) 的会话，就临时造一个「假 HOME」，
// 里面 .qoder 软链到真实的 ~/.qoder-cn，再 HOME=假home python3 export.py，脚本就透明地读 CN 库。
//
// 用法（独立运行）：
//   node collect-trajectories.mjs --cmd qoderclicn --workspace /tmp/t3-regress/vote-app \
//        --out /tmp/t3-eval/evidence/<model> [--label <model-name>]
//
// 也可被 import：collectTrajectories({ cmd, workspace, outDir, label, log })。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();

// CLI 二进制 → 它的会话/配置根目录。qodercli(国际)=~/.qoder，qoderclicn(国内)=~/.qoder-cn。
const CLI_STORE = {
  qodercli: path.join(HOME, '.qoder'),
  qoderclicn: path.join(HOME, '.qoder-cn'),
};
function storeHome(cmd) { return CLI_STORE[cmd] || path.join(HOME, '.qoder'); }

// 复用 export-session 的导出逻辑，但用仓库里 vendored 的一份（loop/vendor/export-session.py）。
// 相比原版，它支持环境变量 QODER_CLI_DIRNAME 指定 Qoder CLI 会话目录（.qoder / .qoder-cn），
// 从而无需"假 HOME"就能分别导出国际版/国内版的会话。找不到 vendored 再回退到已装 skill。
function resolveExportScript() {
  const vendored = path.join(__dirname, 'vendor', 'export-session.py');
  if (fs.existsSync(vendored)) return vendored;
  const cands = [
    path.join(HOME, '.qoder-cn', 'skills', 'export-session', 'scripts', 'export.py'),
    path.join(HOME, '.qoder', 'skills', 'export-session', 'scripts', 'export.py'),
    path.join(HOME, '.qoderwork', 'skills', 'export-session', 'scripts', 'export.py'),
  ];
  return cands.find((p) => fs.existsSync(p)) || null;
}

// 从某 CLI 的 settings.json 取真实 model.name（用于命名 evidence 子目录 / manifest）
function resolveModelName(cmd) {
  try {
    const p = path.join(storeHome(cmd), 'settings.json');
    if (!fs.existsSync(p)) return null;
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return (d && d.model && d.model.name) || null;
  } catch { return null; }
}

// 读 .team3-project.json，收集各角色的全部 session id（runing + done[]）
// 返回 [{ role, id, state }]，state ∈ running|done
function readSessionIds(workspace) {
  const pjPath = path.join(workspace, '.team3-project.json');
  if (!fs.existsSync(pjPath)) {
    throw new Error(`找不到 ${pjPath}（workspace 是否已被清理？轨迹须在该轮跑完、下一轮开跑前立刻收集）`);
  }
  const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
  const partner = pj.partner || {};
  const out = [];
  const seen = new Set();
  for (const [agentKey, info] of Object.entries(partner)) {
    if (!info || typeof info !== 'object' || !info.session) continue;
    const role = agentKey.replace(/_agent$/, ''); // arch_agent → arch
    const s = info.session;
    const push = (id, state) => {
      if (id && typeof id === 'string' && !seen.has(id)) { seen.add(id); out.push({ role, id, state }); }
    };
    push(s.runing, 'running');
    for (const d of (Array.isArray(s.done) ? s.done : [])) push(d, 'done');
  }
  return out;
}

// 造「假 HOME」的老办法已废弃：vendored 脚本支持 QODER_CLI_DIRNAME，直接指目录即可。

export function collectTrajectories({ cmd, workspace, outDir, label, prefix = '', log = () => {} }) {
  const script = resolveExportScript();
  if (!script) throw new Error('找不到 export-session 的 scripts/export.py（skill 是否已安装？）');
  const store = storeHome(cmd);
  const modelLabel = label || resolveModelName(cmd) || cmd;
  const pfx = prefix ? `${prefix}.` : ''; // 文件名前缀（如 baseline. / compare.），同目录区分两模型

  fs.mkdirSync(outDir, { recursive: true });
  const sessions = readSessionIds(workspace);
  log(`发现 ${sessions.length} 个 session（模型=${modelLabel}，库=${store}）`);

  // vendored 脚本读 QODER_CLI_DIRNAME 决定 Qoder CLI 会话目录：
  // qodercli→.qoder（默认），qoderclicn→.qoder-cn。不再需要假 HOME。
  const env = { ...process.env, QODER_CLI_DIRNAME: path.basename(store) };

  const manifest = { cmd, model: modelLabel, store, workspace, exportedAt: new Date().toISOString(), sessions: [] };
  for (const { role, id, state } of sessions) {
    const r = spawnSync('python3', [
      script, '--session', id, '--project', workspace, '--output', outDir,
    ], { env, encoding: 'utf-8' });
    let zip = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || null;
    let ok = r.status === 0 && zip && fs.existsSync(zip);
    if (ok && pfx) {
      // 加 baseline./compare. 前缀，便于同一 evidence 目录里按文件名区分两模型
      const named = path.join(outDir, pfx + path.basename(zip));
      fs.renameSync(zip, named);
      zip = named;
    }
    if (ok) {
      log(`  ✓ [${role}/${state}] ${id.slice(0, 8)} → ${path.basename(zip)}`);
      manifest.sessions.push({ role, id, state, zip: path.basename(zip) });
    } else {
      // 某些历史/异常 session 可能已无记录，跳过不致命
      log(`  ⚠ [${role}/${state}] ${id.slice(0, 8)} 导出失败（exit=${r.status}）：${(r.stderr || '').trim().split('\n').pop() || ''}`);
      manifest.sessions.push({ role, id, state, zip: null, error: (r.stderr || '').trim().slice(-200) });
    }
  }

  fs.writeFileSync(path.join(outDir, `${pfx}manifest.json`), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  const okCount = manifest.sessions.filter((s) => s.zip).length;
  log(`轨迹收集完成：${okCount}/${sessions.length} 个 zip → ${outDir}`);
  return { outDir, model: modelLabel, total: sessions.length, ok: okCount, manifest };
}

/* ---------------------------- CLI ---------------------------- */

function parseArgs(argv) {
  const out = { cmd: 'qodercli', workspace: '/tmp/t3-regress/vote-app', out: null, label: null };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i]; const v = a[i + 1];
    if (k === '--cmd' && v) out.cmd = (i++, v);
    else if ((k === '--workspace' || k === '-w') && v) out.workspace = (i++, v);
    else if (k === '--out' && v) out.out = (i++, v);
    else if (k === '--label' && v) out.label = (i++, v);
  }
  if (!out.out) out.out = path.join('/tmp/t3-eval/evidence', out.label || out.cmd);
  return out;
}

// 仅在作为脚本直接运行时执行 CLI（被 import 时不触发）
if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  const opts = parseArgs(process.argv);
  const res = collectTrajectories({
    cmd: opts.cmd, workspace: opts.workspace, outDir: opts.out, label: opts.label,
    log: (m) => process.stdout.write(`[collect] ${m}\n`),
  });
  process.exit(res.ok > 0 ? 0 : 1);
}
