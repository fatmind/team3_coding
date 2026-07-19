import * as fs from "node:fs";
import puppeteerCore, { type Browser, type LaunchOptions } from "puppeteer-core";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
];

function findChrome(): string {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Local Chrome not found. Searched: ${CHROME_PATHS.join(", ")}`);
}

export async function launchBrowser(opts?: LaunchOptions): Promise<Browser> {
  return puppeteerCore.launch({
    headless: true,
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...opts,
  });
}

export type { Browser, Page } from "puppeteer-core";
