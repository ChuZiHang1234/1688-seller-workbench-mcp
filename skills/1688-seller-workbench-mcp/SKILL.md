---
name: 1688-seller-workbench-mcp
description: Use when the user wants Codex to operate the 1688 Alibaba seller workbench at work.1688.com through a local MCP browser bridge, including login checks, page inspection, screenshots, navigation, clicking, filling forms, and future seller operations.
---

# 1688 Seller Workbench MCP

Use this skill for browser-based control of the 1688 seller workbench (`work.1688.com`).
It provides a local MCP server that launches Chrome or Edge with a persistent profile, so
the user's login state can be reused across sessions. The server connects through a
local Chrome DevTools Protocol (CDP) port so the browser can stay open between MCP
tool calls.

## MCP Tools

When available, use these tools:

- `work1688_status` - show MCP config, browser path, profile directory, and current URL.
- `work1688_open` - open the 1688 seller workbench or another allowed 1688/Alibaba URL.
- `work1688_check_login` - check whether the current page appears logged in.
- `work1688_probe` - inspect visible text, links/buttons, and inputs on the current page.
- `work1688_screenshot` - save a screenshot for visual review.
- `work1688_click_text` - click a visible element by text, label, placeholder, or title.
- `work1688_fill` - fill an input by label, placeholder, name, id, or CSS selector.
- `work1688_upload_files` - upload one or more local files through a file input or upload control.
- `work1688_press` - press a keyboard key such as `Enter` or `Escape`.
- `work1688_close` - close the browser context.

## Standard Workflow

1. Start with `work1688_status`.
2. Call `work1688_open` for the seller workbench URL.
3. Call `work1688_check_login`.
4. If login or verification is required, keep the visible browser open and ask the user to
   scan, log in, or complete verification. Do not try to bypass CAPTCHA or platform checks.
5. Use `work1688_probe` and `work1688_screenshot` before taking page actions.
6. Use text-driven controls (`work1688_click_text`, `work1688_fill`, `work1688_press`) for
   low-level navigation and form work.
7. For Alibaba picture-manager dialogs, click the upload tab/control first, then use
   `work1688_upload_files` with `inputIndex` if the visible upload button is backed by
   a transparent `input[type=file]`.

## Safety Rules

- Read-only inspection is allowed after login.
- For irreversible or business-impacting actions, such as publishing products, editing
  prices, changing inventory, sending customer messages, cancelling orders, refunds, or
  committing paid services, inspect first and get the user's confirmation before the final
  click.
- Do not automate attempts to evade platform moderation, anti-abuse systems, CAPTCHA, or
  verification.
- Stay within the allowed domains baked into the MCP server: `1688.com`, `alibaba.com`,
  and required Alibaba login/CDN domains.

## Setup

Run the repository installer from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer copies this skill into the current user's Codex skill directory, installs
Node dependencies, and registers the `work1688` MCP server in the user's Codex config.

For manual development, the MCP server can also be run from this skill folder:

```powershell
npm install
node src/mcp-server.js
```

If Chrome or Edge is installed in a non-standard location, set `WORK1688_BROWSER_EXE`.
Optional environment variables:

- `WORK1688_PROFILE_DIR`
- `WORK1688_OUTPUT_DIR`
- `WORK1688_TIMEOUT_MS`
- `WORK1688_CDP_PORT`
