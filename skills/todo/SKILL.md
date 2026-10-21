---
name: todo
tile: TODO
description: The user's todo list in ~/.mortimer/todo.md - list, add, tick off, start the most urgent. Use for /todo, "add ...", "done N".
user-invocable: true
---

# Todo

The list lives in ~/.mortimer/todo.md, one item per line: `- [ ] text (due YYYY-MM-DD)` or `- [x] text`.

- "/todo": numbered open items, overdue first, then by due date.
- "/todo add <text> [due <date>]": append it, then show the list.
- "/todo done N": tick item N as numbered in the last list, then show the list.
- "/todo next": start working on the most urgent open item, after one line saying which.
- Phone card: up to 8 items, chips ADD (input "What should I add?") and NEXT (send "/todo next").
