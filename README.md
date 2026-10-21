# Mortimer plugin

Claude Code plugin behind Mortimer, the Android home-screen widget for your agent (https://heymortimer.com).

## Install

1. Install Mortimer on your Android phone from Google Play.
2. In Claude Code on your computer:
   ```
   /plugin marketplace add edouarddaunizeau-ai/mortimer
   /plugin install mortimer@mortimer
   ```
3. Restart Claude Code with the phone channel on (channels are in research preview, so unlisted channel plugins need this flag):
   ```
   claude --dangerously-load-development-channels plugin:mortimer@mortimer
   ```
4. Run `/mortimer:setup`: three questions, a check of which tools are connected, then a one-time code to pair your phone. During the beta, sign-up needs an invite code.

Keep that Claude Code session running: it is what the widget talks to.

## What's inside

- `server.mjs`: the phone connector, a Claude Code channel. Taps queued at the relay arrive as `<channel source="phone">` messages; `card`, `status` and `capabilities` tools go back out.
- `skills/`: setup plus the workflows behind the tiles. A skill's `requires:` frontmatter decides when its tile is live.
  - Base (always live): todo, decide, post, trip, fit, gtm.
  - calendar: today, brief, weekends. gmail: triage, subs. calendar + gmail: prep.
  - github: build. github + vercel: ship, validate. always-on: watch.
- `scripts/watch.py`: page watches for the watch skill (Python 3 stdlib, state in ~/.mortimer/watches.json, alerts appended to alerts.md; never sends). Pages that build their content with JavaScript are loaded in headless Chromium by `scripts/render.mjs` when Playwright is available (optional dependency; `npx playwright install chromium` adds the browser), otherwise the watch falls back to raw HTML and says why.
- `hooks/`: session-start (standing rules plus the user's profile) and a Bash safety guard.
- `test/`: `npm test` runs unit tests and an end-to-end run against a fake relay. `test/mock-relay.mjs` is the fake relay for manual runs.

User data lives in `~/.mortimer/` (profile.md, caps.json, todo.md, link.env with mode 600, plus watches.json, alerts.md, subscriptions.md, fit.md, fit-log.md and gtm/ as those skills are used).

Testing in a separate Claude session on a machine that also runs a Telegram channel session: disable the Telegram plugin for the test session, or its poller replaces the live one.
