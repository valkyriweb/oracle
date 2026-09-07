# GPT-6 Astra browser verification — 2026-09-07

## Installed change

- Upstream `54dafa78` merged without rewriting history in `aa78df80`.
- Astra support commit: `e80290dd`.
- Canonical checkout rebuilt; `oracle --version` reports `0.18.1`.
- Local `main` contains the merge and feature; not yet pushed to `origin`.
- Existing user config still selects GPT-5.6/heavy. No default model or authentication setting changed pending end-to-end verification.

## Verified

- Independent source scout confirmed native Claude custom-base routing, 4096 max tokens, 20-second picker mount wait, and tiny-response guard remain.
- Independent review found and prompted correction of early API-only resolution in the root CLI. Bounded re-review passed.
- Lint/typecheck, build, and full test suite passed: 166 files, 2149 tests; 18 files/45 tests skipped by the existing suite.
- Actual CLI subprocess regression verifies browser Astra routing and API alias rejection.
- Installed CLI dry-run selects `GPT-6 Astra`, explicit Pro effort, attach-running mode, and no cookie copying.
- On an isolated Chrome tab, the production selector expression switched GPT-5.6 Sol to `6Pro` via the `Latest` row and verified the observed version.
- Production thinking-time expression switched Medium to Pro and verified the accessible slider announcement, not just the maximum numeric position.

## Blocked live smoke

Session: `astra-pro-markdown-smoke`.

The installed CLI connected to the existing Chrome DevTools endpoint but timed out waiting for Chrome's remote-debugging permission. No prompt was sent. Luke must approve Chrome's prompt before retrying; do not toggle permissions or restart Chrome unattended.

Pending: completed Pro text/Markdown response, synthetic attachment response, output-file integrity, and saved-session replay. Do not claim end-to-end success or universal reliability.

Command shape:

```bash
oracle --engine browser --model gpt-6 --browser-thinking-time pro \
  --browser-attach-running --browser-archive never --retain-hours 0 --wait \
  --prompt "A harmless test prompt"
```

`--browser-archive never` avoids mailbox-like state changes; `--retain-hours 0` disables pruning during verification. Existing interactive chats must remain untouched.
