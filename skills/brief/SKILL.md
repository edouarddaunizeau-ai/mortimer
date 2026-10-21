---
name: brief
tile: BRIEF
requires: [calendar]
description: Morning brief - today's calendar, plus the emails that need a reply and renewals due when Gmail is connected. Use for /brief, "brief me" or "morning brief".
user-invocable: true
---

# Brief

Short, scannable, one recommendation at the end.

1. Calendar: today's events, and the first thing tomorrow.
2. If Gmail tools are present: up to 5 threads from the last 24 hours that need the user's reply (a person wrote, asked something, no reply yet). Skip newsletters, receipts and anything off-limits.
3. Open todos due today or overdue (~/.mortimer/todo.md).
4. If they exist: subscriptions renewing in the next 7 days (annual ones 14) from ~/.mortimer/subscriptions.md, and watch alerts in ~/.mortimer/alerts.md added since the last brief.
5. End with the one thing to do first.
6. Phone card: title "Brief", the top lines, chips TODAY and TODO.
