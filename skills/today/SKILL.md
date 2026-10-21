---
name: today
tile: TODAY
requires: [calendar]
description: The rest of today and tomorrow morning from the user's calendar, one line per event. Use for /today or "what's on today".
user-invocable: true
---

# Today

1. Read the primary calendar, read-only, in the user's time zone (from ~/.mortimer/profile.md): from now to the end of today, plus tomorrow before 12:00.
2. One line per event: time, title, and the location or call link if short. Skip anything that matches an off-limits rule in the profile.
3. Nothing booked: say so in one line.
4. On the phone: a card titled "Today", one line per event, chips for the obvious next step (TODO, BRIEF).
