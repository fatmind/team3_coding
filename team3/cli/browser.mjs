// browser.mjs — puppeteer-core + 本地 Chrome
//
// 用法：
//   import { launchBrowser } from './browser.mjs';
//   const browser = await launchBrowser();
//   const page = await browser.newPage();
//   await browser.close();

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

function findChrome() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Chrome not found. Searched: ${CHROME_PATHS.join(', ')}`);
}

export async function launchBrowser(opts = {}) {
  const chromePath = findChrome();

  return puppeteer.launch({
    executablePath: chromePath,
    headless: opts.headless ?? 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...opts,
  });
}
