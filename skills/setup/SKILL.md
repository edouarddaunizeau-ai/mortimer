---
name: setup
description: Set up Mortimer - about-you questions, find connected tools, pair the phone, show which tiles are live. Use when the user runs /mortimer:setup, asks to set up or pair the phone widget, or asks what they can unlock.
user-invocable: true
---

# Setup

One question at a time. Skip anything already done (check before asking).

1. **About you.** If ~/.mortimer/profile.md is missing, ask three things, one per message: first name, home city and time zone, and anything that is off-limits (for example an employer's email, a client's files). Write the answers to ~/.mortimer/profile.md. The off-limits answer becomes a hard rule: the session-start hook loads it every session.
2. **Find tools.** Check each one quietly and build the list of ids that are ready:
   - calendar, gmail, drive: the session has Google Calendar / Gmail / Google Drive tools (claude.ai connectors). If missing, they connect in one click at claude.ai, Settings, Connectors.
   - github: `timeout 20 gh auth status` succeeds. If not: `gh auth login --web` shows a code the user can enter on their phone.
   - vercel: `timeout 20 vercel whoami` succeeds, or the session has Vercel tools.
   - supabase: the session has Supabase tools, or `timeout 20 supabase projects list` succeeds.
   - telegram: the Telegram channel plugin is installed and configured.
   - always-on: this machine is a server that stays up (ask only if unsure).
     Optional for watch: if `timeout 60 node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" https://example.com` exits 3, offer `npm install && npx playwright install chromium` in the plugin folder so JavaScript pages can be watched.
3. **Record.** Call the phone `capabilities` tool with the ready ids. It returns live tiles, locked tiles and what each missing connection would unlock.
4. **Show the result** in one short message: "N tiles ready" with the live tiles, then the top 3 unlocks ranked by how many tiles they add, each with the one step to connect it. Never paste keys or tokens into chat.
5. **Pair the phone.** Run `timeout 60 node "${CLAUDE_PLUGIN_ROOT}/scripts/pair.mjs"` (add the relay URL as the first argument if the user gave one or MORTIMER_RELAY is unset and the script asks for it). On first run it creates the account and writes ~/.mortimer/link.env itself (mode 600); later runs just issue a new code, e.g. for a second phone. If it says the relay needs an invite code, ask the user for the invite code they were given (8 characters, like ABCD-2345) and rerun with `--invite <code>`. An invite works once. Relay its output to the user: the 8-character code, when it expires (10 minutes, one use), and the pairing link. Tell them: open the link on this computer and scan the QR with the phone, or open the app on the phone, tap PAIR and type the code. Then run `timeout 330 node "${CLAUDE_PLUGIN_ROOT}/scripts/pair.mjs" --check 300` (no new code; waits for that one) and confirm when it prints "Paired". If the code expired, run it again for a new one. Never print, cat or paste link.env or the key; the script never shows it.
6. **First win.** Once paired, suggest tapping TODAY (or TODO if no calendar) on the widget.

Rerun steps 2 to 4 any time the user says they connected something new.

**UNLOCK tile.** A phone message "/unlock <id>" (for example "/unlock gmail") means the user wants that connection. Answer with a card: the one step to connect it (from step 2) and the tiles it adds. When they say it's done, rerun steps 2 to 4; the phone's tiles update by themselves.
