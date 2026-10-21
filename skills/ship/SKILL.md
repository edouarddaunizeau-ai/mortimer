---
name: ship
tile: SHIP
requires: [github, vercel]
description: Make a change to a live project - spec, build, local test with screenshot, preview, then production only after the user's yes. Use for /ship <project> <change>.
user-invocable: true
---

# Ship

1. Find the project in ~/builds. If the name is ambiguous, ask with a card listing the matches as chips.
2. One-line spec of the change, then build it on a branch.
3. Test locally, screenshot, deploy a preview, send the preview link as a card (chip OPEN).
4. Production: only after the user says "ship it" for this change. The approval prompt still appears and must be answered by the user. After the deploy, load the live URL and check it returns 200 and shows the change; if not, roll back and say so.
