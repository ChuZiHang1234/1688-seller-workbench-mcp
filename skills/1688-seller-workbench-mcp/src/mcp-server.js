import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium } from "playwright-core";
import { z } from "zod";

const _stdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function guardedStdoutWrite(chunk, encoding, callback) {
  const text = typeof chunk === "string" ? chunk : chunk.toString();
  if (text.trimStart().startsWith("{")) {
    return _stdoutWrite(chunk, encoding, callback);
  }
  return process.stderr.write(chunk, encoding, callback);
};
console.log = console.error;
console.warn = console.error;
console.info = console.error;
console.debug = console.error;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const home = process.env.USERPROFILE || homedir();

const DEFAULT_URL =
  "https://work.1688.com/home/seller.htm?spm=a2615.2177701/2506.topmenu.dsellercenterentry_popup_dsellercenter";
const PROFILE_DIR =
  process.env.WORK1688_PROFILE_DIR || join(home, ".codex", "browser", "work1688-profile");
const OUTPUT_DIR =
  process.env.WORK1688_OUTPUT_DIR || join(home, ".codex", "browser", "work1688-output");
const DEFAULT_TIMEOUT = Number(process.env.WORK1688_TIMEOUT_MS || 45_000);
const CDP_PORT = Number(process.env.WORK1688_CDP_PORT || 16888);
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

const ALLOWED_HOSTS = [
  "1688.com",
  "alibaba.com",
  "alicdn.com",
  "aliyun.com",
  "mmstat.com",
  "taobao.com",
  "tmall.com",
];

let browser = null;
let context = null;
let page = null;

function ensureDirs() {
  mkdirSync(PROFILE_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function findBrowserExecutable() {
  const candidates = [
    process.env.WORK1688_BROWSER_EXE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(home, "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function assertAllowedUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Only http/https URLs are allowed: ${rawUrl}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  );
  if (!allowed) {
    throw new Error(
      `Blocked navigation to ${hostname}. Allowed domains: ${ALLOWED_HOSTS.join(", ")}`
    );
  }
}

function clipText(value, max = 5000) {
  if (!value) return "";
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function escapeCssIdent(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char.codePointAt(0).toString(16)} `);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCdpVersion() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function waitForCdp(timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const version = await getCdpVersion();
    if (version?.webSocketDebuggerUrl) {
      return version;
    }
    await sleep(350);
  }
  throw new Error(`Chrome CDP did not become ready at ${CDP_URL} within ${timeout}ms.`);
}

function launchExternalBrowser(startUrl = DEFAULT_URL, visible = true) {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error(
      "Could not find Chrome or Edge. Set WORK1688_BROWSER_EXE to a browser executable path."
    );
  }

  assertAllowedUrl(startUrl);
  ensureDirs();

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--start-maximized",
  ];

  if (!visible) {
    args.push("--headless=new");
  }

  args.push(startUrl);

  const child = spawn(executablePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: !visible,
  });
  child.unref();
  return { pid: child.pid, executablePath };
}

async function ensureExternalBrowser({ startUrl = DEFAULT_URL, visible = true } = {}) {
  const existing = await getCdpVersion();
  if (existing?.webSocketDebuggerUrl) {
    return { launched: false, version: existing };
  }

  const launch = launchExternalBrowser(startUrl, visible);
  const version = await waitForCdp();
  return { launched: true, ...launch, version };
}

async function ensurePage({ startUrl = DEFAULT_URL, visible = true } = {}) {
  ensureDirs();

  if (page && !page.isClosed()) {
    return page;
  }

  await ensureExternalBrowser({ startUrl, visible });
  browser = await chromium.connectOverCDP(CDP_URL);
  context = browser.contexts()[0] || await browser.newContext({ acceptDownloads: true });

  const pages = context.pages();
  page = pages.find((candidate) => {
    try {
      const host = new URL(candidate.url()).hostname;
      return host.includes("1688.com") || host.includes("alibaba.com");
    } catch {
      return false;
    }
  }) || pages[0] || await context.newPage();

  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);

  if (!page.url() || page.url() === "about:blank") {
    assertAllowedUrl(startUrl);
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT });
  }

  return page;
}

async function summarizePage(activePage) {
  const frames = activePage.frames().map((frame, index) => ({
    index,
    url: frame.url(),
    name: frame.name(),
  }));

  const data = await activePage.evaluate(() => {
    const visibleText = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        style.visibility === "hidden" ||
        style.display === "none" ||
        rect.width === 0 ||
        rect.height === 0
      ) {
        return "";
      }
      return (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
    };

    const controls = Array.from(
      document.querySelectorAll("a,button,input,textarea,select,[role='button']")
    )
      .slice(0, 160)
      .map((el, index) => ({
        index,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || "",
        text: visibleText(el).slice(0, 120),
        ariaLabel: (el.getAttribute("aria-label") || "").slice(0, 120),
        placeholder: (el.getAttribute("placeholder") || "").slice(0, 120),
        href: (el.getAttribute("href") || "").slice(0, 180),
        role: el.getAttribute("role") || "",
        disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true"),
      }))
      .filter((item) => item.text || item.ariaLabel || item.placeholder || item.href);

    const inputs = Array.from(document.querySelectorAll("input,textarea,select"))
      .slice(0, 80)
      .map((el, index) => ({
        index,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || "",
        name: el.getAttribute("name") || "",
        id: el.id || "",
        placeholder: el.getAttribute("placeholder") || "",
        ariaLabel: el.getAttribute("aria-label") || "",
        valuePreview: String(el.value || "").slice(0, 80),
      }));

    return {
      bodyText: (document.body?.innerText || "").slice(0, 8000),
      controls,
      inputs,
    };
  });

  return {
    url: activePage.url(),
    title: await activePage.title(),
    frames,
    textPreview: clipText(data.bodyText, 4000),
    controls: data.controls,
    inputs: data.inputs,
  };
}

function getSearchScopes(activePage) {
  return activePage.frames().map((frame, index) => ({ frame, index, url: frame.url() }));
}

function elementLocators(scope, text, exact) {
  const matcher = exact ? { exact: true } : undefined;
  const escaped = text.replaceAll('"', '\\"');
  return [
    scope.frame.getByText(text, matcher).first(),
    scope.frame.getByRole("button", { name: text, exact }).first(),
    scope.frame.getByRole("link", { name: text, exact }).first(),
    scope.frame.getByPlaceholder(text, matcher).first(),
    scope.frame.getByLabel(text, matcher).first(),
    scope.frame.locator(`[title="${escaped}"]`).first(),
  ];
}

function fillLocators(scope, target) {
  const escaped = target.replaceAll('"', '\\"');
  return [
    scope.frame.getByLabel(target).first(),
    scope.frame.getByPlaceholder(target).first(),
    scope.frame.locator(target).first(),
    scope.frame.locator(`[name="${escaped}"]`).first(),
    scope.frame.locator(`#${escapeCssIdent(target)}`).first(),
  ];
}

async function clickTextInAnyFrame(activePage, text, exact, timeout) {
  let lastError = null;
  for (const scope of getSearchScopes(activePage)) {
    for (const locator of elementLocators(scope, text, exact)) {
      try {
        if ((await locator.count()) > 0) {
          await locator.click({ timeout });
          return scope;
        }
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw new Error(`Could not click "${text}". ${lastError?.message || ""}`.trim());
}

async function fillInAnyFrame(activePage, target, value, submit, timeout) {
  let lastError = null;
  for (const scope of getSearchScopes(activePage)) {
    for (const locator of fillLocators(scope, target)) {
      try {
        if ((await locator.count()) > 0) {
          await locator.fill(value, { timeout });
          if (submit) {
            await locator.press("Enter", { timeout });
          }
          return scope;
        }
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw new Error(`Could not fill "${target}". ${lastError?.message || ""}`.trim());
}

function inferLoginState(summary) {
  const url = summary.url.toLowerCase();
  const text = `${summary.title}\n${summary.textPreview}`.toLowerCase();
  const needsLogin =
    url.includes("login") ||
    url.includes("passport") ||
    text.includes("登录") ||
    text.includes("扫码") ||
    text.includes("密码") ||
    text.includes("验证码");
  const likelyLoggedIn =
    url.includes("work.1688.com") &&
    (text.includes("工作台") ||
      text.includes("卖家") ||
      text.includes("店铺") ||
      text.includes("订单") ||
      text.includes("商品"));

  return {
    loggedIn: likelyLoggedIn && !url.includes("login") && !url.includes("passport"),
    needsLogin,
    reason: needsLogin
      ? "Page looks like a login or verification page."
      : likelyLoggedIn
        ? "Page contains common seller workbench signals."
        : "Login state is unclear from current page signals.",
  };
}

async function maybeWaitForStable(activePage, timeout) {
  try {
    await activePage.waitForLoadState("networkidle", { timeout });
  } catch {
    try {
      await activePage.waitForLoadState("domcontentloaded", { timeout: Math.min(timeout, 5000) });
    } catch {
      // Keep the current page state. Some Alibaba pages keep long-running requests open.
    }
  }
}

function jsonText(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function errorText(err) {
  return {
    content: [{ type: "text", text: err?.stack || err?.message || String(err) }],
    isError: true,
  };
}

const server = new McpServer({
  name: "work1688-mcp",
  version: "0.1.0",
});

server.registerTool(
  "work1688_status",
  {
    description: "Return local 1688 workbench MCP configuration and browser session status.",
    inputSchema: {},
  },
  async () => {
    try {
      const executablePath = findBrowserExecutable();
      const cdpVersion = await getCdpVersion();
      return jsonText({
        ok: true,
        browserRunning: Boolean(cdpVersion?.webSocketDebuggerUrl),
        currentUrl: page && !page.isClosed() ? page.url() : null,
        cdpUrl: CDP_URL,
        cdpPort: CDP_PORT,
        browserVersion: cdpVersion?.Browser || null,
        profileDir: PROFILE_DIR,
        outputDir: OUTPUT_DIR,
        defaultUrl: DEFAULT_URL,
        executablePath,
        allowedHosts: ALLOWED_HOSTS,
      });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  "work1688_open",
  {
    description:
      "Open the 1688 seller workbench in a persistent visible browser profile. Login state is kept in the profile directory.",
    inputSchema: {
      url: z.string().url().default(DEFAULT_URL).describe("1688 or Alibaba URL to open."),
      visible: z.boolean().default(true).describe("Launch a visible browser for QR/login flows."),
      timeout: z.number().default(DEFAULT_TIMEOUT).describe("Navigation timeout in milliseconds."),
    },
  },
  async ({ url, visible, timeout }) => {
    try {
      assertAllowedUrl(url);
      const activePage = await ensurePage({ startUrl: url, visible });
      await activePage.goto(url, { waitUntil: "domcontentloaded", timeout });
      await maybeWaitForStable(activePage, Math.min(timeout, 12_000));
      const summary = await summarizePage(activePage);
      return jsonText({
        ok: true,
        ...summary,
        login: inferLoginState(summary),
      });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  "work1688_check_login",
  {
    description:
      "Check whether the current 1688 workbench page appears logged in. If not logged in, keep the browser open so the user can scan or complete verification.",
    inputSchema: {
      openIfNeeded: z.boolean().default(true),
      timeout: z.number().default(DEFAULT_TIMEOUT),
    },
  },
  async ({ openIfNeeded, timeout }) => {
    try {
      const activePage = openIfNeeded
        ? await ensurePage({ startUrl: DEFAULT_URL, visible: true })
        : page;
      if (!activePage || activePage.isClosed()) {
        return jsonText({ ok: false, loggedIn: false, message: "Browser page is not open." });
      }
      await maybeWaitForStable(activePage, Math.min(timeout, 10_000));
      const summary = await summarizePage(activePage);
      return jsonText({
        ok: true,
        ...inferLoginState(summary),
        url: summary.url,
        title: summary.title,
        profileDir: PROFILE_DIR,
        note: "If this reports needsLogin=true, complete login in the visible browser and call this tool again.",
      });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  "work1688_probe",
  {
    description:
      "Inspect the current 1688 workbench page: URL, title, visible text preview, controls, and form inputs.",
    inputSchema: {
      openIfNeeded: z.boolean().default(true),
    },
  },
  async ({ openIfNeeded }) => {
    try {
      const activePage = openIfNeeded
        ? await ensurePage({ startUrl: DEFAULT_URL, visible: true })
        : page;
      if (!activePage || activePage.isClosed()) {
        return jsonText({ ok: false, message: "Browser page is not open." });
      }
      const summary = await summarizePage(activePage);
      return jsonText({ ok: true, ...summary, login: inferLoginState(summary) });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  "work1688_screenshot",
  {
    description: "Save a screenshot of the current 1688 workbench page to a local PNG file.",
    inputSchema: {
      fullPage: z.boolean().default(true),
      openIfNeeded: z.boolean().default(true),
    },
  },
  async ({ fullPage, openIfNeeded }) => {
    try {
      const activePage = openIfNeeded
        ? await ensurePage({ startUrl: DEFAULT_URL, visible: true })
        : page;
      if (!activePage || activePage.isClosed()) {
        return jsonText({ ok: false, message: "Browser page is not open." });
      }
      ensureDirs();
      const filePath = join(OUTPUT_DIR, `work1688_${Date.now()}.png`);
      await activePage.screenshot({ path: filePath, fullPage });
      return jsonText({
        ok: true,
        path: filePath,
        url: activePage.url(),
        title: await activePage.title(),
      });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  "work1688_click_text",
  {
    description:
      "Click a visible element on the current 1688 workbench page by text, aria-label, placeholder, or title.",
    inputSchema: {
      text: z.string().min(1).describe("Visible text or accessible label to click."),
      exact: z.boolean().default(false).describe("Use exact text matching."),
      timeout: z.number().default(DEFAULT_TIMEOUT),
    },
  },
  async ({ text, exact, timeout }) => {
    try {
      const activePage = await ensurePage({ startUrl: DEFAULT_URL, visible: true });
      const scope = await clickTextInAnyFrame(activePage, text, exact, timeout);

      await maybeWaitForStable(activePage, Math.min(timeout, 10_000));
      const summary = await summarizePage(activePage);
      return jsonText({ ok: true, clickedText: text, frame: scope, ...summary });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  "work1688_fill",
  {
    description:
      "Fill an input on the current 1688 workbench page by label, placeholder, name, id, or CSS selector.",
    inputSchema: {
      target: z.string().min(1).describe("Label, placeholder, name, id, or CSS selector."),
      value: z.string().describe("Value to fill."),
      submit: z.boolean().default(false).describe("Press Enter after filling."),
      timeout: z.number().default(DEFAULT_TIMEOUT),
    },
  },
  async ({ target, value, submit, timeout }) => {
    try {
      const activePage = await ensurePage({ startUrl: DEFAULT_URL, visible: true });
      const scope = await fillInAnyFrame(activePage, target, value, submit, timeout);

      await maybeWaitForStable(activePage, Math.min(timeout, 10_000));
      const summary = await summarizePage(activePage);
      return jsonText({ ok: true, filledTarget: target, submitted: submit, frame: scope, ...summary });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  "work1688_upload_files",
  {
    description:
      "Upload one or more local files on the current 1688 page. By default it clicks an upload control such as 添加图片 and sets the file chooser.",
    inputSchema: {
      filePaths: z.array(z.string()).min(1).describe("Absolute local file paths to upload."),
      targetText: z.string().default("添加图片").describe("Visible upload control text to click."),
      exact: z.boolean().default(false).describe("Use exact text matching for the upload control."),
      inputIndex: z.number().int().nonnegative().optional().describe("Optional global input[type=file] index across frames."),
      timeout: z.number().default(DEFAULT_TIMEOUT),
    },
  },
  async ({ filePaths, targetText, exact, inputIndex, timeout }) => {
    try {
      for (const filePath of filePaths) {
        if (!existsSync(filePath)) {
          throw new Error(`File does not exist: ${filePath}`);
        }
      }

      const activePage = await ensurePage({ startUrl: DEFAULT_URL, visible: true });
      let frame = null;

      if (inputIndex !== undefined) {
        let seen = 0;
        let uploaded = false;
        for (const scope of getSearchScopes(activePage)) {
          const fileInputs = scope.frame.locator('input[type="file"]');
          const count = await fileInputs.count();
          if (inputIndex < seen + count) {
            await fileInputs.nth(inputIndex - seen).setInputFiles(filePaths, { timeout });
            frame = scope;
            uploaded = true;
            break;
          }
          seen += count;
        }
        if (!uploaded) {
          throw new Error(`No input[type=file] found at global index ${inputIndex}. Found ${seen} file inputs.`);
        }
      } else {
        const fileChooserPromise = activePage.waitForEvent("filechooser", { timeout });
        frame = await clickTextInAnyFrame(activePage, targetText, exact, timeout);
        const chooser = await fileChooserPromise;
        await chooser.setFiles(filePaths);
      }

      await maybeWaitForStable(activePage, Math.min(timeout, 10_000));
      const summary = await summarizePage(activePage);
      return jsonText({
        ok: true,
        uploaded: filePaths,
        targetText,
        inputIndex: inputIndex ?? null,
        frame,
        ...summary,
      });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  "work1688_press",
  {
    description: "Press a keyboard key on the current 1688 workbench page.",
    inputSchema: {
      key: z.string().min(1).describe("Playwright key name, e.g. Enter, Escape, Control+A."),
      timeout: z.number().default(DEFAULT_TIMEOUT),
    },
  },
  async ({ key, timeout }) => {
    try {
      const activePage = await ensurePage({ startUrl: DEFAULT_URL, visible: true });
      await activePage.keyboard.press(key, { timeout });
      await maybeWaitForStable(activePage, Math.min(timeout, 8000));
      const summary = await summarizePage(activePage);
      return jsonText({ ok: true, key, ...summary });
    } catch (err) {
      return errorText(err);
    }
  }
);

server.registerTool(
  "work1688_close",
  {
    description: "Close the browser context used by the 1688 workbench MCP server.",
    inputSchema: {},
  },
  async () => {
    try {
      let closeBrowser = browser;
      if (!closeBrowser) {
        const cdpVersion = await getCdpVersion();
        if (cdpVersion?.webSocketDebuggerUrl) {
          closeBrowser = await chromium.connectOverCDP(CDP_URL);
        }
      }
      if (closeBrowser) {
        await closeBrowser.close();
      }
      browser = null;
      context = null;
      page = null;
      return jsonText({ ok: true, message: "1688 workbench browser closed." });
    } catch (err) {
      return errorText(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
