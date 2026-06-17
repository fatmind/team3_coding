/**
 * Module 4 Feature #1: init-ui-rules CLI + prompt updates
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const TEAM3_DIR = path.join(process.cwd(), '..');
const HUMAN_CODING = path.join(TEAM3_DIR, 'human_coding');
const CLI_DIR = path.join(TEAM3_DIR, 'cli');

async function loadInitUiRulesCore() {
  return import(pathToFileURL(path.join(CLI_DIR, 'init-ui-rules-core.mjs')).href);
}

function makeFakeStyleSeedDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'team3-styleseed-'));
  fs.mkdirSync(path.join(root, 'engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'engine', 'CLAUDE.md'), '# Claude\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'engine', 'DESIGN-LANGUAGE.md'), '# Design\n', 'utf-8');
  fs.mkdirSync(path.join(root, 'skins', 'toss'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'skins', 'toss', 'theme.css'),
    [
      ':root {',
      '  --brand: #000000;',
      '  --background: #ffffff;',
      '  --foreground: #111111;',
      '  --surface-page: #eeeeee;',
      '  --primary: #111111;',
      '  --primary-foreground: #ffffff;',
      '}',
      '.dark {',
      '  --brand: #000000;',
      '}',
      '',
    ].join('\n'),
    'utf-8',
  );
  return root;
}

describe('Module 4 Feature #1: init-ui-rules', () => {
  it('cli/init-ui-rules.mjs and init-ui-rules-core.mjs exist in same directory', () => {
    expect(fs.existsSync(path.join(CLI_DIR, 'init-ui-rules.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(CLI_DIR, 'init-ui-rules-core.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(CLI_DIR, 'lib'))).toBe(false);
  });

  it('arch_prompt records brand in spec and uses [ui-init] on dev_do, not Arch CLI', () => {
    const content = fs.readFileSync(path.join(HUMAN_CODING, 'arch_prompt.md'), 'utf-8');
    expect(content).toContain('[ui-init:');
    expect(content).toContain('Arch 不执行 CLI');
    expect(content).toContain('https://github.com/VoltAgent/awesome-design-md');
    expect(content).toContain('交互草稿图: spec/ux_xxx.png');
    expect(content).toContain('## UX/UI 输入');
    expect(content).not.toContain('Brand source: human_selected | arch_default');
    expect(content).not.toContain('在派发 Dev 前执行 UI 规则初始化');
  });

  it('dev_prompt STEP 2 includes init-ui-rules after environment init', () => {
    const content = fs.readFileSync(path.join(HUMAN_CODING, 'dev_prompt.md'), 'utf-8');
    expect(content).toContain('init-ui-rules.mjs');
    expect(content).toContain('[ui-init:');
    expect(content).toContain('node cli/init-ui-rules.mjs . --brand <品牌名>');
    expect(content).toContain('不要自己换品牌、不要猜色值');
    expect(content).toContain('UI Quality Evidence');
    expect(content).toContain('theme_source: skin:<brand> | design-md:<brand> | failed:<reason>');
  });

  it('arch_prompt MODE B checklist checks UI hard evidence only', () => {
    const content = fs.readFileSync(path.join(HUMAN_CODING, 'arch_prompt.md'), 'utf-8');
    expect(content).toContain('UI feature：Dev 是否提交 UI 硬证据');
    expect(content).toContain('缺 `ui_init` / `theme_source` / 真实页面截图路径 / `/ss-lint` 结果');
  });

  it('init-ui-rules resolves awesome-design-md brand into theme.css and stable summary', async () => {
    const styleseedDir = makeFakeStyleSeedDir();
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team3-ui-target-'));
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ devDependencies: {} }), 'utf-8');
    const { runInitUiRules } = await loadInitUiRulesCore();

    const summary = await runInitUiRules({
      targetDir,
      brand: 'mintlify',
      styleseedDir,
      fetchImpl: async () => ({
        ok: true,
        text: async () => [
          'colors:',
          '  brand-green: "#00d4a4"',
          '  canvas: "#ffffff"',
          '  ink: "#111111"',
          '  surface-soft: "#f7f7f7"',
          '  on-primary: "#ffffff"',
        ].join('\n'),
      }),
      log: () => {},
    });

    expect(summary.brand).toBe('mintlify');
    expect(summary.themeSource).toBe('design-md:mintlify');
    expect(summary.engineCopied).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(targetDir, 'css', 'theme.css'), 'utf-8')).toContain('--brand: #00d4a4');
    expect(fs.existsSync(path.join(targetDir, 'postcss.config.mjs'))).toBe(true);
  });

  it('init-ui-rules fails clearly for missing brand before copying engine files', async () => {
    const styleseedDir = makeFakeStyleSeedDir();
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team3-ui-target-'));
    const { runInitUiRules } = await loadInitUiRulesCore();

    await expect(runInitUiRules({
      targetDir,
      brand: 'not-a-brand',
      styleseedDir,
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        text: async () => '',
      }),
      log: () => {},
    })).rejects.toThrow('init-ui-rules will not guess colors');

    expect(fs.existsSync(path.join(targetDir, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'DESIGN-LANGUAGE.md'))).toBe(false);
  });
});
