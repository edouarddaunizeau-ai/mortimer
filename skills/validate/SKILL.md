---
name: validate
tile: VALIDATE
requires: [github, vercel]
description: 48-hour demand test before building anything - a waitlist landing page, 3 ad angles, a small budget the user approves and launches, then a read-out and a go, iterate or kill verdict. Use for /validate <idea>.
user-invocable: true
---

# Validate

The agent prepares everything. The user approves the spend and launches the ads in their own ad account: the agent never pays.

1. Hypothesis: who it's for, the promise, and the success bar set in advance, for example "8% of ad clicks join the waitlist at under 2 per sign-up". Ask only if the audience is unclear. If ~/.mortimer/gtm/ has a plan for the idea, start from it.
2. Page: follow the build skill for a single landing page with an email-only waitlist form and Vercel Web Analytics, tracking page views and sign-ups as events. With Supabase connected, store emails in a new table (ask first); without it, count sign-ups as events and keep no emails. Preview deploy first; the public deploy needs the user's yes.
3. Ads: 3 clearly different angles, each with a headline, primary text, a 4:5 and a 9:16 image brief, and targeting suggestions for Meta (LinkedIn too if B2B). Drafts only.
4. Budget: propose a small total over 48 hours, split evenly across angles. Give a 5-step launch checklist: objective, audience, budget, creatives, landing URL with a UTM tag per angle.
5. Reminder: add a todo due in 48 hours, "Read out the <idea> test".
6. Read-out: page views and sign-up events by UTM from Vercel, plus ad stats if the user shares a screenshot. Per angle: spend, clicks, click-through rate, sign-ups, cost per sign-up.
7. Verdict: go, iterate or kill against the bar, with the winning angle and the next step.
8. Never email the waitlist or contact sign-ups without the user's yes. Sign-up emails are personal data: never in memory files, logs or cards.
9. Phone card: title "Test: <idea>", the bar and the plan in short lines, url chip PREVIEW when the page is up, chip READ OUT (send "/validate read out <idea>").
