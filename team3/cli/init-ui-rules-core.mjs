// init-ui-rules-core.mjs — StyleSeed UI rules injection for managed projects
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

export const BUILTIN_SKINS = new Set([
  'stripe', 'linear', 'notion', 'toss', 'vercel', 'arc', 'raycast',
]);

/** awesome-design-md folder name may differ from skin folder */
export const BRAND_TO_SKIN = {
  'linear.app': 'linear',
  linear: 'linear',
};

export const TAILWIND_DEV_DEPS = {
  tailwindcss: '^4.1.0',
  '@tailwindcss/postcss': '^4.1.0',
  postcss: '^8.5.0',
};

const CSS_VAR_SOURCES = {
  '--brand': ['brand-green', 'brand', 'accent', 'primary-brand'],
  '--background': ['canvas', 'background'],
  '--foreground': ['ink', 'primary'],
  '--surface-page': ['surface-soft', 'surface'],
  '--primary': ['primary', 'ink'],
  '--primary-foreground': ['on-primary', 'on-primary'],
};

export function normalizeBrand(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function resolveSkinFolder(brand) {
  const normalized = normalizeBrand(brand);
  const aliased = BRAND_TO_SKIN[normalized] || normalized;
  return BUILTIN_SKINS.has(aliased) ? aliased : null;
}

export function resolveDesignMdSlug(brand) {
  const normalized = normalizeBrand(brand);
  if (BRAND_TO_SKIN[normalized]) return normalized;
  return normalized;
}

export function parseDesignMdColors(markdown) {
  const colors = {};
  const re = /^\s+([a-z0-9-]+):\s+"(#[0-9A-Fa-f]{3,8})"/gm;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    colors[match[1]] = match[2];
  }
  return colors;
}

export function pickColor(colors, keys) {
  for (const key of keys) {
    if (colors[key]) return colors[key];
  }
  return null;
}

export function lightenHex(hex, amount = 0.3) {
  const raw = hex.replace('#', '');
  const full = raw.length === 3
    ? raw.split('').map((c) => c + c).join('')
    : raw.slice(0, 6);
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const mix = (channel) => Math.min(255, Math.round(channel + (255 - channel) * amount));
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

export function replaceCssVar(css, varName, value) {
  const re = new RegExp(`(${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*)([^;\\n]+)`);
  return css.replace(re, `$1${value}`);
}

export function applyColorsToTheme(templateCss, colors) {
  let css = templateCss;
  for (const [cssVar, sourceKeys] of Object.entries(CSS_VAR_SOURCES)) {
    const value = pickColor(colors, sourceKeys);
    if (value) css = replaceCssVar(css, cssVar, value);
  }
  const brand = pickColor(colors, CSS_VAR_SOURCES['--brand']);
  if (brand) {
    const rootPart = css.includes('.dark') ? css.slice(0, css.indexOf('.dark')) : css;
    const darkPart = css.includes('.dark') ? css.slice(css.indexOf('.dark')) : '';
    css = replaceCssVar(rootPart, '--brand', brand) + replaceCssVar(darkPart, '--brand', lightenHex(brand));
  }
  return css;
}

export function designMdUrl(slug) {
  return `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/${slug}/DESIGN.md`;
}

export function patchClaudeMdBrand(claudeMd, brand) {
  const display = brand.charAt(0).toUpperCase() + brand.slice(1);
  const block = [
    '',
    '## Brand (init-ui-rules)',
    '',
    `Visual style: ${display} (from awesome-design-md / StyleSeed skin).`,
    `- Brand name: ${brand}`,
    '- Use semantic CSS tokens from css/theme.css — never hardcode hex in components.',
    '- After UI changes → run /ss-lint to verify compliance.',
    '',
  ].join('\n');

  if (claudeMd.includes('## Brand (init-ui-rules)')) {
    return claudeMd.replace(/## Brand \(init-ui-rules\)[\s\S]*?(?=\n## |\n# |$)/, block.trim() + '\n');
  }
  return `${claudeMd.trimEnd()}\n${block}`;
}

export function copyTree(srcDir, destDir, { skipExisting = true, log = () => {} } = {}) {
  const copied = [];
  const skipped = [];

  function walk(rel = '') {
    const current = path.join(srcDir, rel);
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = rel ? path.join(rel, entry.name) : entry.name;
      const srcPath = path.join(srcDir, relPath);
      const destPath = path.join(destDir, relPath);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        walk(relPath);
        continue;
      }
      if (skipExisting && fs.existsSync(destPath)) {
        skipped.push(relPath);
        continue;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      copied.push(relPath);
    }
  }

  fs.mkdirSync(destDir, { recursive: true });
  walk();
  log({ copied, skipped });
  return { copied, skipped };
}

export function mergeTailwindDeps(packageJsonPath) {
  if (!fs.existsSync(packageJsonPath)) {
    return { updated: false, reason: 'no package.json' };
  }
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  pkg.devDependencies = pkg.devDependencies || {};
  let changed = false;
  for (const [name, version] of Object.entries(TAILWIND_DEV_DEPS)) {
    if (pkg.devDependencies[name] !== version) {
      pkg.devDependencies[name] = version;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  }
  return { updated: changed, reason: changed ? 'merged devDependencies' : 'already present' };
}

export function ensurePostCssConfig(targetDir) {
  const configPath = path.join(targetDir, 'postcss.config.mjs');
  if (fs.existsSync(configPath)) return { created: false };
  const content = `export default {\n  plugins: {\n    '@tailwindcss/postcss': {},\n  },\n};\n`;
  fs.writeFileSync(configPath, content, 'utf-8');
  return { created: true };
}

export function ensureStyleSeedCache(cacheDir, { exec = execSync, fetchRemote = true } = {}) {
  const engineDir = path.join(cacheDir, 'engine');
  if (fs.existsSync(path.join(engineDir, 'CLAUDE.md'))) {
    return cacheDir;
  }
  if (!fetchRemote) {
    throw new Error(`StyleSeed cache missing at ${cacheDir} and fetchRemote=false`);
  }
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  exec(`git clone --depth 1 https://github.com/bitjaru/styleseed.git "${cacheDir}"`, {
    stdio: 'pipe',
  });
  return cacheDir;
}

export async function fetchDesignMd(slug, fetchImpl = fetch) {
  const url = designMdUrl(slug);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch DESIGN.md for brand "${slug}" (${res.status}) at ${url}. ` +
      'Ask Human/Arch to choose another awesome-design-md brand; init-ui-rules will not guess colors.',
    );
  }
  return res.text();
}

export async function resolveThemeCss({ brand, styleseedDir, fetchImpl = fetch }) {
  const skin = resolveSkinFolder(brand);
  if (skin) {
    const skinPath = path.join(styleseedDir, 'skins', skin, 'theme.css');
    if (!fs.existsSync(skinPath)) {
      throw new Error(`Built-in skin theme.css not found: ${skinPath}`);
    }
    return {
      source: `skin:${skin}`,
      content: fs.readFileSync(skinPath, 'utf-8'),
    };
  }

  const slug = resolveDesignMdSlug(brand);
  const designMd = await fetchDesignMd(slug, fetchImpl);
  const colors = parseDesignMdColors(designMd);
  if (Object.keys(colors).length === 0) {
    throw new Error(
      `No colors parsed from DESIGN.md for brand "${brand}". ` +
      'Ask Human/Arch to choose another brand or fix the DESIGN.md; init-ui-rules will not guess colors.',
    );
  }
  const templatePath = path.join(styleseedDir, 'skins', 'toss', 'theme.css');
  const template = fs.readFileSync(templatePath, 'utf-8');
  return {
    source: `design-md:${slug}`,
    content: applyColorsToTheme(template, colors),
  };
}

export async function runInitUiRules({
  targetDir,
  brand,
  styleseedDir,
  skipExisting = true,
  fetchImpl = fetch,
  log = console.log,
}) {
  const absTarget = path.resolve(targetDir);
  const normalizedBrand = normalizeBrand(brand);
  if (!normalizedBrand) {
    throw new Error('--brand is required');
  }

  fs.mkdirSync(absTarget, { recursive: true });

  const engineSrc = path.join(styleseedDir, 'engine');
  if (!fs.existsSync(path.join(engineSrc, 'CLAUDE.md'))) {
    throw new Error(`StyleSeed engine not found at ${engineSrc}`);
  }

  const theme = await resolveThemeCss({ brand: normalizedBrand, styleseedDir, fetchImpl });

  const { copied, skipped } = copyTree(engineSrc, absTarget, {
    skipExisting,
    log: () => {},
  });
  const themeDest = path.join(absTarget, 'css', 'theme.css');
  fs.mkdirSync(path.dirname(themeDest), { recursive: true });
  if (!skipExisting || !fs.existsSync(themeDest)) {
    fs.writeFileSync(themeDest, theme.content, 'utf-8');
  }

  const claudePath = path.join(absTarget, 'CLAUDE.md');
  if (fs.existsSync(claudePath)) {
    const next = patchClaudeMdBrand(fs.readFileSync(claudePath, 'utf-8'), normalizedBrand);
    fs.writeFileSync(claudePath, next, 'utf-8');
  }

  const pkgResult = mergeTailwindDeps(path.join(absTarget, 'package.json'));
  const postcssResult = ensurePostCssConfig(absTarget);

  const summary = {
    targetDir: absTarget,
    brand: normalizedBrand,
    themeSource: theme.source,
    engineCopied: copied.length,
    engineSkipped: skipped.length,
    tailwind: pkgResult,
    postcss: postcssResult,
  };

  log(JSON.stringify(summary, null, 2));
  return summary;
}

export function parseCliArgs(argv) {
  const args = argv.slice(2);
  if (args.length < 1) return null;

  const result = { targetDir: args[0], brand: null, styleseedDir: null, force: false };
  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    const val = args[i + 1];
    if (key === '--brand' && val != null) { result.brand = val; i++; }
    else if (key === '--styleseed-dir' && val != null) { result.styleseedDir = val; i++; }
    else if (key === '--force') { result.force = true; }
  }
  return result;
}

export function defaultStyleSeedDir() {
  if (process.env.STYLESEED_DIR) return process.env.STYLESEED_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const team3Root = path.resolve(here, '..');
  return path.join(team3Root, '.cache', 'styleseed');
}
