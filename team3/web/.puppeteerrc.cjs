/**
 * Puppeteer 配置 - 跳过自带 Chrome 下载，运行时使用本机 Chrome。
 *
 *   skipDownload    npm install 时不再下载 ~150MB 的 Chrome for Testing。
 *   executablePath  puppeteer.launch() 默认使用的 Chrome 可执行路径；
 *                   优先取 PUPPETEER_EXECUTABLE_PATH 环境变量，
 *                   否则按平台用本机 Google Chrome 的标准安装路径。
 *
 * 如果本机 Chrome 不在标准位置，导出环境变量覆盖即可：
 *   export PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
 *
 * 注意：puppeteer pin 的是 Chrome for Testing 版本，本机 Chrome 是 stable
 * 频道，绝大多数 CDP API 兼容；如 e2e 出现版本相关诡异问题，再考虑改回 pinned。
 */

const platformDefault = (() => {
  switch (process.platform) {
    case "darwin":
      return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    case "linux":
      return "/usr/bin/google-chrome";
    case "win32":
      return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    default:
      return undefined;
  }
})();

module.exports = {
  skipDownload: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || platformDefault,
};
