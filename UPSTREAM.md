# UPSTREAM.md — fork provenance

|                         |                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Upstream**            | https://github.com/steipete/oracle (MIT)                                                                                         |
| **Fork**                | https://github.com/valkyriweb/oracle                                                                                             |
| **Forked from**         | `main` @ `c5839ef6` ("docs: credit browser model picker fix"), 2026-06-23                                                        |
| **Last upstream merge** | `7cf5b032` (upstream main incl. ChatGPT Chat/Work layout support), 2026-10-09                                                    |
| **Distribution**        | Local build, run via the shim `~/.local/bin/oracle` → `dist/bin/oracle-cli.js`. Not published; not installed through npm global. |
| **Upstreaming**         | Not planned (private-use fork, per Luke). The two fixes below are genuine upstream bugs and could be PR'd later if desired.      |

## Why the fork

Luke runs oracle on **subscription auth only** — never a pay-per-token API key.
GPT-5.5 Pro / Gemini go through the **browser** engine (ChatGPT / Google
subscription); Claude goes through **claude-bridge**, a local Anthropic-protocol
proxy on `127.0.0.1:9100` backed by his Claude subscription. The stock npm build
broke the Claude-via-bridge path, and the patches were getting wiped on every
`npm i -g`. The fork makes them durable and rebuildable.

The subscription policy itself (stripping `OPENAI_API_KEY`/`OPENROUTER_API_KEY`/
`AZURE_OPENAI_API_KEY`, setting `ANTHROPIC_BASE_URL` + a placeholder
`ANTHROPIC_API_KEY`) lives in the launcher shim `~/.local/bin/oracle`, **not** in
this source — it is Luke-specific config, not a code change.

## Divergence from upstream

Local behavior retained across non-rewriting upstream merges:

- **`fix(client): route Claude through the native Anthropic client for custom base URLs.**
  `src/oracle/client.ts`— upstream routes *any* custom/proxy base URL (incl.
  Claude) through the OpenAI chat/completions adapter, which sends Claude to`/v1/responses`and 404s against an Anthropic-protocol proxy. The fork routes
  Claude through`createClaudeClient` (raw fetch to the Anthropic Messages API)
  for **any** base URL, so claude-bridge (`/v1/messages`) works. Test updated in
  `tests/oracle/clientFactory.test.ts` (`FORK: routes claude custom base URLs
  through the native Anthropic client`).

- **`fix(browser): widen model-picker mount wait 8s → 20s.**
  `src/browser/actions/modelSelection.ts`— upstream already added a bounded`ensureModelSelection`poll loop (good), but the 8s default lost the race when
  the composer pill mounted ~14s after the textarea (observed under load / large
  prompts on Pro). Widened`MODEL_BUTTON_WAIT_MS` to 20000. Zero cost on the
  happy path — the loop exits the instant the pill renders.

- **`fix(claude): double Claude max_tokens 2048 → 4096.**
  `src/oracle/claude.ts`— the Anthropic Messages API requires`max_tokens`, and
  upstream hardcodes a low 2048, silently truncating longer Claude answers
  (`stop_reason: max_tokens`). Doubled to 4096. Still hardcoded (not yet wired to
  a flag/config).

- **Browser capture guard.** Non-trivial prompts that produce suspiciously tiny answers fail rather than recording a misleading success. Upstream's newer harvest-identity checks are retained alongside this guard.

- **GPT-6 Astra browser selection (retired 2026-10-11).** The fork's own Astra picker adapter (`astraModelSelection.ts`) was replaced by upstream's native GPT-6 support during the October upstream merge. GPT-6 aliases now follow upstream semantics (`gpt-6`, `gpt-6-astra`, `gpt-6-pro` map to ChatGPT's `GPT-6` picker row).

## Cookie sync

Upstream disables live-profile cookie copying by default (`3a185f55`) to avoid invalidating the interactive login. Without another auth source, every browser run lands on the ChatGPT login wall ("No ChatGPT cookies were applied"). On 2026-10-11 Luke approved opting back in through `~/.oracle/config.json` (`browser.cookieSync: true`); the code default stays upstream's. Alternatives: an authenticated persistent Oracle profile or `--browser-attach-running`. Headless is supported upstream again but still depends on ChatGPT accepting that browser session.

## Refresh from upstream

```bash
cd ~/Projects/personal/oracle
git fetch upstream
git log --oneline HEAD..upstream/main     # what's new
git merge --no-edit upstream/main          # with Luke's per-action approval
corepack pnpm install --frozen-lockfile
corepack pnpm run lint && corepack pnpm test
corepack pnpm run build
```

The shim runs `dist/bin/oracle-cli.js` from this checkout, so a successful
`pnpm build` is all that's needed to activate an update — no reinstall.

Reconcile overlapping upstream fixes by behavior and tests; do not discard the remaining fork changes or rewrite shared history.
