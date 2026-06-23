# UPSTREAM.md — fork provenance

| | |
|---|---|
| **Upstream** | https://github.com/steipete/oracle (MIT) |
| **Fork** | https://github.com/valkyriweb/oracle |
| **Forked from** | `main` @ `c5839ef6` ("docs: credit browser model picker fix"), 2026-06-23 |
| **Distribution** | Local build, run via the shim `~/.local/bin/oracle` → `dist/bin/oracle-cli.js`. Not published; not installed through npm global. |
| **Upstreaming** | Not planned (private-use fork, per Luke). The two fixes below are genuine upstream bugs and could be PR'd later if desired. |

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

Each bullet = one local commit on top of `upstream/main`.

- **`fix(client): route Claude through the native Anthropic client for custom base URLs.**
  `src/oracle/client.ts` — upstream routes *any* custom/proxy base URL (incl.
  Claude) through the OpenAI chat/completions adapter, which sends Claude to
  `/v1/responses` and 404s against an Anthropic-protocol proxy. The fork routes
  Claude through `createClaudeClient` (raw fetch to the Anthropic Messages API)
  for **any** base URL, so claude-bridge (`/v1/messages`) works. Test updated in
  `tests/oracle/clientFactory.test.ts` (`FORK: routes claude custom base URLs
  through the native Anthropic client`).

- **`fix(browser): widen model-picker mount wait 8s → 20s.**
  `src/browser/actions/modelSelection.ts` — upstream already added a bounded
  `ensureModelSelection` poll loop (good), but the 8s default lost the race when
  the composer pill mounted ~14s after the textarea (observed under load / large
  prompts on Pro). Widened `MODEL_BUTTON_WAIT_MS` to 20000. Zero cost on the
  happy path — the loop exits the instant the pill renders.

## Refresh from upstream

```bash
cd ~/Projects/personal/oracle
git fetch upstream
git log --oneline HEAD..upstream/main     # what's new
git rebase upstream/main                   # reapply the two fork commits
corepack pnpm install
corepack pnpm run lint && corepack pnpm test   # 3 locale-formatting failures are pre-existing upstream
corepack pnpm run build
```

The shim runs `dist/bin/oracle-cli.js` from this checkout, so a successful
`pnpm build` is all that's needed to activate an update — no reinstall.

If upstream ever ships the Claude custom-base-URL fix, drop that commit and keep
only the picker-wait tweak (or retire the fork entirely).
