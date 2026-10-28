# Tandem

**One cockpit for Claude Code and Codex.** Tandem is a native macOS desktop app that drives the
Claude Code CLI (Anthropic) and the Codex CLI (OpenAI) side by side: one timeline, one approval
queue, one composer. You keep paying Anthropic and OpenAI for the subscriptions you already have;
Tandem is a one-time purchase that makes them work as a team.

![home](docs/01-home.png)

![split](docs/02-session-split.png)

## What it does

| Capability | Claude Code | Codex |
| --- | --- | --- |
| Streamed replies, tool calls, diffs, shell output | stream-json protocol over stdin/stdout | app-server JSON-RPC (`codex app-server --stdio`) |
| Approvals in the UI (allow once / always / deny with a reason) | `can_use_tool` control requests | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` |
| Clarifying questions | `AskUserQuestion` | `item/tool/requestUserInput` |
| Permission posture (Ask / Auto-edit / Full auto / Plan) | `--permission-mode` + `set_permission_mode` | `approvalPolicy` + `sandboxPolicy` on `turn/start` |
| Model and effort switching | `set_model`, `--effort` | `model` / `effort` on `turn/start`, `model/list` |
| Computer use (see and control the screen) | interactive CLI in the built-in terminal; Tandem enables the `computer-use` MCP server for the project | `features.computer_use` on the thread + a developer instruction |
| In-app browser (Tandem's own pane) | `--mcp-config` → `tandem-browser` HTTP MCP server | `mcp_servers.tandem_browser` on the thread |
| External Chrome | `--chrome` → Claude in Chrome extension tools (works in `-p` mode) | Chrome DevTools MCP bridge injected per thread (Codex's native Browser is desktop-app only) |
| Resume conversations | `--resume <session id>` | `thread/resume` |
| Sign-in detection | `claude auth status`, `~/.claude.json`, SDK `initialize` → account | `account/read`, `account/login/start` (opens the ChatGPT OAuth page), `account/rateLimits/read` |
| Usage meters | rate-limit events | 5-hour / weekly windows from `account/rateLimits/read` |

Plus:

- **In-app browser.** A real Chromium pane docked inside Tandem that either agent can navigate, snapshot, click, type in and screenshot, while you watch (and can take over with the mouse). Logins persist in Tandem's own browser profile.
- **Side-by-side mode.** Send the same prompt to both agents and compare them in split view.
- **Hand-off.** One click sends the task, the original request, and the last update to the other agent in a fresh session in the same folder.
- **Embedded terminal.** Open the raw `claude` or `codex` TUI in a tab when you want the native experience (and for Claude computer use, which the CLI only offers interactively).
- **Session history** persisted locally, with cost, token and context meters.
- **Offline licensing.** Ed25519-signed keys, 14-day trial, no server, no telemetry.

## Design

The UI borrows the parts of the current agent apps that work and sharpens them:

- **Rail + sessions + dock**, like Claude Code Desktop and the Codex app: an icon rail with account
  usage rings, a collapsible sessions column with agent ribbons, and a right dock for the in-app
  browser and terminal. ⌘\ collapses the sessions column.
- **Activity groups**: consecutive tool calls fold into one card ("Worked · 1 edit, 1 command ·
  48s") with expandable rows, so a 40-step run reads as a short story instead of a log.
- **Autonomy as a segmented control** in the title bar (Plan · Ask · Auto-edit · Full auto),
  the agentic-UX pattern of making the permission spectrum visible rather than buried.
- **Approval cards that demand attention**: an animated conic highlight, "Needs you" label and a
  deny-with-reason field, and a status-bar counter when any session is waiting.
- **Command palette** (⌘K) for sessions, panes, theme and hand-off; a monospaced status bar with
  live agent state, context and cost.
- **Type**: Geist Sans for UI and Geist Mono for paths, refs and numbers (bundled, OFL). Layered
  graphite surfaces with inset highlights, grain, and the warm/cool dual accent; glass only on
  floating layers. Equally finished light theme.

Screenshots in `docs/` are produced by `node e2e/screenshot.mjs --demo`.

## How it talks to the CLIs

Tandem never calls Anthropic or OpenAI APIs itself and never touches your credentials. Each
agent runs as the official CLI, signed in with your own account:

- **Claude Code** is spawned as
  `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-prompt-tool stdio --permission-mode <mode> --session-id <uuid>`.
  Tandem sends `{"type":"user",...}` turns, answers `control_request/can_use_tool` with
  `control_response`, and uses `control_request` subtypes `initialize`, `interrupt`,
  `set_permission_mode`, `set_model`. Verified against Claude Code 2.1.310.
- **Codex** runs one shared `codex app-server --stdio`. Tandem speaks JSON-RPC 2.0 over NDJSON:
  `initialize` → `initialized`, `thread/start|resume`, `turn/start|steer|interrupt`, and reacts to
  `item/*`, `turn/*`, `thread/tokenUsage/updated`, `account/*` notifications. Approval requests
  arrive as server→client requests and are answered by id. Verified against Codex CLI 0.164.0.
  Regenerate the protocol types with `codex app-server generate-ts --out <dir>` when upgrading.

### Computer use, honestly

- **Codex**: the `computer_use` feature flag is stable and on by default in Codex 0.164. Tandem sets
  it on the thread and tells the model the user wants screen control. Codex controls only the apps
  you allow under `computer_use.macos.bundle_ids` in `~/.codex/config.toml` (macOS only).
- **Claude Code**: computer use is a built-in MCP server (`computer-use`) that is macOS-only, needs
  a Pro or Max plan, and is **not available in `-p` (headless) mode**. Tandem therefore enables the
  server for the project (the same thing `/mcp → Enable` does, by adding `computer-use` to
  `projects[cwd].enabledMcpServers` in `~/.claude.json`) and opens an interactive `claude` session in
  the embedded terminal when you turn the toggle on. macOS will ask for Accessibility and Screen
  Recording permission the first time.

### The in-app browser

Tandem hosts a `WebContentsView` (Chromium, isolated `persist:tandem-browser` profile) docked next to
the chat and exposes it as an MCP server on `127.0.0.1` with a per-launch bearer token
(`src/main/services/browserMcp.ts`, Streamable HTTP transport). Claude Code gets it through
`--mcp-config` as `tandem-browser`; Codex gets it through `mcp_servers.tandem_browser` in its thread
config. Tools: `navigate`, `snapshot` (interactive elements with refs like `[e12] button "Sign in"`
plus page text), `click`, `type`, `press_key`, `scroll`, `select_option`, `screenshot`, `get_text`,
`evaluate`, `console_messages`, `network_requests`, `wait_for`, `go_back`, `go_forward`, `reload`.
The pane shows an "agent driving" badge while a tool call runs, and the URL bar, back/forward and
reload stay usable by you. Toggle it per session with the **Tandem browser** chip or ⌘B.

### External browser use, honestly

- **Claude Code**: `--chrome` works in Tandem's headless mode. The CLI loads the `claude-in-chrome`
  MCP server with `navigate`, `read_page`, `find`, `form_input`, `computer`, `read_console_messages`,
  `read_network_requests`, `gif_creator` and friends, and drives the Chrome you are logged into
  through the [Claude in Chrome](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn)
  extension (v1.0.36+). Requirements: Chrome/Edge/Brave/Arc with the extension signed in to the same
  claude.ai account, and a direct Anthropic plan (Pro, Max, Team, Enterprise). API-key auth turns it
  off. Per-site "Claude in Chrome wants to…" prompts arrive as ordinary approval cards.
- **Codex**: OpenAI's Browser feature and the Codex Chrome extension are granted only to the Codex
  desktop app through a code-signed native pipe; every other app-server client gets
  "Browser is not available: extension" (openai/codex#26820, open). When you turn Browser on for a
  Codex session, Tandem instead injects Google's
  [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) server into the
  thread (`mcp_servers.chrome_devtools = npx -y chrome-devtools-mcp@latest`) and tells the model to
  use it. That needs Node/npx on the Mac and opens its own Chrome window. It is a bridge, not
  OpenAI's native integration.

## Development

```bash
cd tandem
npm install          # downloads Electron; node-pty is rebuilt for Electron by electron-builder
npm run dev          # electron-vite dev server with HMR
npm run typecheck
npm test             # unit tests
TANDEM_LIVE=1 npm run test:live   # protocol tests against your real claude / codex binaries
```

If `node-pty` fails to build for Electron on your machine, run `npm run rebuild` (it needs the
Electron headers; Xcode Command Line Tools on macOS). The app still runs without it; the embedded
terminal falls back to a plain pipe.

### Screenshots / smoke test

```bash
npm run build
node e2e/screenshot.mjs --demo     # launches the built app via Playwright and writes e2e/shots/*.png
```

## Building the Mac app

```bash
npm run dist:mac          # current arch → release/Tandem-<version>-<arch>.dmg (+ .zip)
npm run dist:mac:all      # arm64 and x64
```

`electron-builder.yml` targets macOS 12+, enables hardened runtime and dark mode. For distribution
outside your own machine, sign and notarize with your Apple Developer ID: set `CSC_LINK` /
`CSC_KEY_PASSWORD` and `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` in the
environment before `npm run dist:mac`. Unsigned builds run locally after right-click → Open.

## Selling it (pay once, own it)

1. `npm run license:keygen` once. It writes `.tandem-license-private.pem` (keep it private) and
   prints a public key. Paste that into `PUBLIC_KEY_PEM` in `src/main/services/license.ts`
   and rebuild. The committed key is a throwaway development key.
2. For each purchase: `npm run license:sign -- --licensee "Jane Doe" --email jane@example.com`
   prints a `TANDEM-…` key. Email it with the download link. Any storefront that can run a
   script on purchase (Lemon Squeezy, Paddle, Gumroad, Stripe webhooks) can call this.
3. The buyer pastes the key under **Settings → License**. Verification is offline (Ed25519), so
   the app works forever without a server. Nothing phones home.

Tandem does not resell Anthropic or OpenAI access. Buyers bring their own Claude and ChatGPT
subscriptions, sign in through the official CLIs, and Tandem detects that sign-in.

## Layout

```
tandem/
  src/main/                 Electron main process
    agents/claude/          Claude Code stream-json adapter
    agents/codex/           Codex app-server JSON-RPC client + session adapter
    services/               detection/auth, sessions, persistence, terminals, license, settings
  src/preload/              contextBridge → window.tandem
  src/renderer/             React UI (zustand store, timeline, approvals, composer, terminal)
  src/shared/               types + IPC contract shared by both sides
  scripts/                  license keygen / signing
  tests/                    unit tests; tests/live hits the real CLIs
  e2e/                      Playwright-driven screenshot smoke test
```
