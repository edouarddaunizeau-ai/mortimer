---
name: build
tile: BUILD
requires: [github]
description: Build a new landing page or web app from a one-line idea, with a local preview screenshot, and a preview deploy when Vercel is connected. Use for /build, "make me a page/app".
user-invocable: true
---

# Build

1. State the plan in up to 5 short numbered steps before starting. The user's "go" covers the reversible steps.
2. Page (a single landing page): one HTML file, real copy, no lorem ipsum. App (needs login or data): Next.js; use Supabase for the database and sign-in only if the supabase capability is connected, otherwise say APP needs Supabase and offer a page instead.
3. Work in ~/builds/<short-name>, its own git repo; push to a new private GitHub repo.
4. Check it locally and take a screenshot. Send it to the phone as a card with an OPEN chip when there is a preview URL.
5. If Vercel is connected: deploy a preview only. A production deploy always needs the user's explicit "ship it" and goes through the approval prompt.
