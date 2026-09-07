# GPT-6 Astra browser verification — 2026-09-07

## Installed change

- Upstream `54dafa78` merged without rewriting history in `aa78df80`.
- Astra support commit: `e80290dd`.
- Canonical checkout rebuilt; `oracle --version` reports `0.18.1`.
- Local `main` contains the merge and feature. Its commits are published on `origin/update/astra-pro` in draft PR https://github.com/valkyriweb/oracle/pull/3; the remote default branch is unchanged pending verification/review.
- Existing user config still selects GPT-5.6/heavy. No default model or authentication setting changed pending end-to-end verification.

## Verified

- Independent source scout confirmed native Claude custom-base routing, 4096 max tokens, 20-second picker mount wait, and tiny-response guard remain.
- Independent review found and prompted correction of early API-only resolution in the root CLI. Bounded re-review passed.
- Lint/typecheck, build, and full test suite passed: 166 files, 2149 tests; 18 files/45 tests skipped by the existing suite.
- Actual CLI subprocess regression verifies browser Astra routing and API alias rejection.
- Installed CLI dry-run selects `GPT-6 Astra`, explicit Pro effort, attach-running mode, and no cookie copying.
- On an isolated Chrome tab, the production selector expression switched GPT-5.6 Sol to `6Pro` via the `Latest` row and verified the observed version.
- Production thinking-time expression switched Medium to Pro and verified the accessible slider announcement, not just the maximum numeric position.

## Live smoke and remaining handoff

Completed session: `astra-pro-approved-smoke` (exit 0, 61.3 seconds).

The installed CLI verified `resolvedLabel=6Pro`, Pro effort, and authenticated login; submitted the harmless prompt; captured the complete Markdown answer; wrote a 705-byte output file; and replayed the saved session successfully. The answer preserved its heading, checklist, fenced JavaScript, and final sum 42. Browser-tab cleanup logged a failure, despite successful answer capture and CLI exit.

Evidence: `~/.oracle/sessions/astra-pro-approved-smoke/artifacts/transcript.md`, `/tmp/oracle-astra-approved.log`, `/tmp/oracle-astra-approved-answer.md`, and `/tmp/oracle-astra-approved-replay.log`.

The subsequent `astra-pro-attachment-smoke` failed before submission at another 20-second Chrome debugging-approval timeout. Its monitor was stopped at closeout. Earlier failed CLI processes did not exit cleanly; the two identified stale test processes were terminated during closeout without killing shared browsers or services. Do not infer that one successful attach permanently grants future connections.

### Published WIP — draft PR #3

- Branches/commits: feature `update/astra-pro` at `e80290dd`; integrated local `main` also contains merge `aa78df80` and this handoff.
- Issue/PR: https://github.com/valkyriweb/oracle/pull/3 (draft). GitHub Issues are disabled on the fork; this PR owns the remaining verification and handoff.
- Why incomplete: attachment approval blocked; mbp-13 SSH inventory timed out; OpenClaw/PinchTab compatibility has not been exercised.
- Next action: establish the explicitly authorized isolated authenticated browser path, run the synthetic attachment test and replay, then install/review/test the update on mbp-13. Verify OpenClaw/PinchTab CDP compatibility before changing transport. Finish defaults and mark the PR ready only after the relevant checks/review.
- Verification: 2149 deterministic tests and live text capture/replay passed; attachments, mbp-13, PinchTab stealth/cookie login, OpenClaw node transport, and live in-flight reattachment remain unverified. Existing user defaults are unchanged.

## Related OpenClaw client work

Production was checked read-only: OpenClaw 2026.9.2 (`93f5d81`), image `v2026.9.2-r275`, ready replica and matching rollout revisions.

At Luke's request, local m2-max and Mac Mini CLIs were updated from isolated 2026.9.1 installs to isolated npm 2026.9.2 (`3928bad`) installs under `~/.local/lib/openclaw/2026.9.2`; `~/.local/bin/openclaw` links were switched only after version/config validation. Both CLI versions and config validation passed; both expose `cookie-sync` and `import-profile`. Old installs remain. No gateway/node service was restarted; local node-status verification timed out, so this does not establish node runtime health or upgrade running nodes.

OpenClaw documentation supports host-local `import-profile`, domain-allowlisted `cookie-sync` to a remote Gateway, and browser-node routing/pinning. Import does not run through the node proxy and transfers cookies, not local storage/IndexedDB. These docs do not establish PinchTab/stealth or Oracle compatibility. Luke approved cookie copying/import for this login work, but no cookies were transferred in this session.

Command shape:

```bash
oracle --engine browser --model gpt-6 --browser-thinking-time pro \
  --browser-attach-running --browser-archive never --retain-hours 0 --wait \
  --prompt "A harmless test prompt"
```

`--browser-archive never` avoids mailbox-like state changes; `--retain-hours 0` disables pruning during verification. Existing interactive chats must remain untouched.
