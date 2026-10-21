---
name: watch
tile: WATCH
requires: [always-on]
description: Watch a public web page (a careers page, a price, tickets, a news feed) and flag it only when it changes. Read-only. Use for /watch <what> [url], "/watch list", "/watch remove N".
user-invocable: true
---

# Watch

Read-only on the web: never log in, fill forms or buy. The script is scripts/watch.py in this plugin: `timeout 300 python3 "${CLAUDE_PLUGIN_ROOT}/scripts/watch.py" <command>`. State lives in ~/.mortimer/watches.json, new alerts in ~/.mortimer/alerts.md.

1. "/watch <what> [url]": if there is no URL, find the most specific public page with web search (a careers page filtered to the role, a product or ticket page, a news RSS feed). Pages behind a login or a bot wall won't work: say so and suggest an RSS feed or the site's own alerts.
2. Change mode (default): `add "<label>" <url> --focus "word1, word2"`. Focus words keep it to the part that matters, so banners and timestamps don't trigger alerts. ';' makes AND groups. Price mode: add `--below <amount>`.
3. Run `peek N` and check the focused text is the right part. Pages that load their content with JavaScript are rendered in headless Chromium when it is available (`--render auto`, the default, detects them; `--render always|never` forces it). If the output has a "Note: could not render" line, Chromium is missing: offer `npm install && npx playwright install chromium` in the plugin folder (asks first). If peek is still empty, say so and remove the watch.
4. Scheduling, once: if no hourly job exists, add one with `crontab` (this asks for approval): `17 * * * * timeout 900 python3 <absolute path to watch.py> check >/dev/null 2>&1`. The check only writes alerts.md; the brief and the next session read new lines from it.
5. "/watch list", "/watch remove N", "/watch peek N", "/watch check" (run now and show any changes).
6. Never watch anything off-limits in ~/.mortimer/profile.md.
7. Reply in one or two lines: what's watched, what triggers an alert, how to stop it.
8. Phone card: title "Watching <label>", one line on the trigger, chips LIST (send "/watch list") and CHECK NOW (send "/watch check").
