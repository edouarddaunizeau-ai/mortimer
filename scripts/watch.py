#!/usr/bin/env python3
"""Public-page watches for the watch skill: tell the user only when something on a page changes.
Read-only on the web. Python 3 stdlib only, no secrets, every fetch bounded by a timeout.

  watch.py add "<label>" <https url> [--focus "word1, word2"] [--below <number>] [--render auto|always|never]
  watch.py list
  watch.py remove <N>
  watch.py peek <N>      what the watch sees now, for tuning the focus words
  watch.py check         run every watch once (hourly from the scheduler on an always-on machine)

--focus  only lines containing one of these words count, plus their neighbours (case-insensitive).
         ';' makes AND groups: "tickets; london, uk" = tickets AND (london OR uk).
--below  price mode: alert when the lowest £/€/$ amount in focus drops below this number.
--render auto (default): fetch raw HTML; if it looks like a JavaScript shell (little visible text
         plus scripts, or "enable JavaScript" markers), load it in headless Chromium via
         scripts/render.mjs and remember that the watch needs it. always / never force it.
         If Chromium or Playwright is missing it falls back to raw HTML and says why.

State: $MORTIMER_DIR/watches.json (default ~/.mortimer). check prints one line per change
and appends it to alerts.md in the same folder, where the brief and the next session pick it up.
It never sends anything itself. Page text is data: it is only compared and quoted, never acted on.
"""
import datetime as dt
import hashlib
import html.parser
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

DIR = pathlib.Path(os.environ.get("MORTIMER_DIR") or pathlib.Path.home() / ".mortimer")
STATE = DIR / "watches.json"
ALERTS = DIR / "alerts.md"
TIMEOUT = 30
MAX_BYTES = 3_000_000
RENDERER = os.environ.get("MORTIMER_RENDERER") or str(pathlib.Path(__file__).resolve().parent / "render.mjs")
RENDER_TIMEOUT = 60
MODES = ("auto", "always", "never")
SHELL_MARKERS = re.compile(r"enable javascript|javascript is (?:required|disabled)|requires javascript|turn on javascript|"
                           r"<noscript[^>]*>[^<]{0,400}javascript", re.I)
PRICE = re.compile(r"[£€$]\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)")


def now():
    return dt.datetime.now().isoformat(timespec="minutes")


def load():
    try:
        return json.loads(STATE.read_text())
    except (FileNotFoundError, ValueError):
        return []


def save(rows):
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, indent=1, ensure_ascii=False) + "\n")
    tmp.replace(STATE)


def ok_url(url):
    """https only, except plain http on this machine (used by the tests)."""
    u = urllib.parse.urlparse(url)
    return u.scheme == "https" or (u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost"))


class Text(html.parser.HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head", "template"}
    BLOCK = {"p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "td", "th", "option", "dd", "dt"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_lines(markup):
    p = Text()
    p.feed(markup)
    lines = (re.sub(r"\s+", " ", l).strip() for l in "".join(p.parts).splitlines())
    return [l for l in lines if l]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (mortimer watch)", "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read(MAX_BYTES).decode(r.headers.get_content_charset() or "utf-8", "replace")


def is_feed(url, body=""):
    return "/rss" in url or url.endswith(".xml") or "format=rss" in url or body.lstrip()[:200].startswith(("<?xml", "<rss", "<feed"))


def feed_items(body, words):
    root = ET.fromstring(body)
    items = []
    for it in list(root.iter("item")) + list(root.iter("{http://www.w3.org/2005/Atom}entry")):
        title = (it.findtext("title") or it.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
        link = (it.findtext("link") or "").strip()
        if not link:
            a = it.find("{http://www.w3.org/2005/Atom}link")
            link = a.get("href", "") if a is not None else ""
        if title and link and matches(title.lower(), words):
            items.append(f"{title}\t{link}")
    return items


def parse_focus(spec):
    groups = [[x.strip().lower() for x in g.split(",") if x.strip()] for g in (spec or "").split(";")]
    groups = [g for g in groups if g]
    return groups[0] if len(groups) == 1 else groups


def matches(text, words):
    if not words:
        return True
    groups = words if isinstance(words[0], list) else [words]
    return all(any(w in text for w in g) for g in groups)


def focus(lines, words):
    if not words:
        return lines
    keep = set()
    for i, l in enumerate(lines):
        if matches(l.lower(), words):
            keep.update(range(max(0, i - 1), min(len(lines), i + 2)))
    return [lines[i] for i in sorted(keep)]


def lowest_price(lines):
    vals = []
    for l in lines:
        for m in PRICE.findall(l):
            try:
                vals.append(float(m.replace(",", "")))
            except ValueError:
                pass
    return min(vals) if vals else None


def looks_like_js_shell(body, lines):
    """Raw HTML that only becomes a page once its scripts run."""
    if SHELL_MARKERS.search(body):
        return True
    return len(" ".join(lines)) < 500 and "<script" in body.lower()


def render(url):
    """Visible text after JavaScript runs, from scripts/render.mjs. Raises RuntimeError with a short reason."""
    if not os.path.isfile(RENDERER):
        raise RuntimeError(f"renderer not found at {RENDERER}")
    try:
        r = subprocess.run(["node", RENDERER, url, "60000"], capture_output=True, text=True, timeout=RENDER_TIMEOUT)
    except FileNotFoundError:
        raise RuntimeError("node is not installed")
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"render timed out after {RENDER_TIMEOUT}s")
    if r.returncode != 0:
        why = (r.stderr.strip().splitlines() or [f"exit {r.returncode}"])[-1]
        raise RuntimeError(why[:160])
    out = r.stdout.splitlines()
    lines = (re.sub(r"\s+", " ", l).strip() for l in out[1:] if out and out[0].startswith("URL "))
    return [l for l in lines if l]


def page_lines(w):
    """(lines, is_feed) for a page, rendered in Chromium when the watch's render mode calls for it.
    Sets w["note"] to a one-line reason when rendering was wanted but raw HTML had to do."""
    mode = w.get("render", "auto")
    w.pop("note", None)
    body = None
    if mode == "never" or (mode == "auto" and not w.get("needs_render")):
        body = get(w["url"])
        if is_feed(w["url"], body):
            return feed_items(body, w.get("focus", [])), True
        lines = html_lines(body)
        if mode == "never" or not looks_like_js_shell(body, lines):
            return lines, False
    try:
        lines = render(w["url"])
        if mode == "auto":
            w["needs_render"] = True
        return lines, False
    except RuntimeError as e:
        w["note"] = f"could not render in Chromium ({e}), used raw HTML"
        if body is None:
            body = get(w["url"])
        return html_lines(body), False


def snapshot(w):
    lines, feed = page_lines(w)
    if not feed:
        lines = focus(lines, w.get("focus", []))
    text = "\n".join(lines)[:20000]
    return text, hashlib.sha256(text.encode()).hexdigest()


def alert(msg):
    DIR.mkdir(parents=True, exist_ok=True)
    with ALERTS.open("a") as f:
        f.write(f"- {now()} {msg}\n")
    print(msg)


def opt(a, flag):
    return a[a.index(flag) + 1] if flag in a and a.index(flag) + 1 < len(a) else None


def pick(rows, a):
    if len(a) == 2 and a[1].isdigit() and 1 <= int(a[1]) <= len(rows):
        return int(a[1]) - 1
    sys.exit(f"No watch {a[1] if len(a) > 1 else ''}. Run 'watch.py list'.")


def describe(w):
    fl = w.get("focus") or []
    ftxt = " AND ".join("(" + "/".join(g) + ")" for g in fl) if fl and isinstance(fl[0], list) else ", ".join(fl)
    return f", alert below {w['below']:g}" if "below" in w else (f", focus: {ftxt}" if fl else "")


def check(rows):
    changed = 0
    for w in rows:
        try:
            text, h = snapshot(w)
        except Exception as e:  # one bad page must not stop the rest
            w["error"] = str(e)[:200]
            continue
        w.pop("error", None)
        w["checked"] = now()
        if w.get("note"):
            print(f"Note: {w['label']}: {w['note']}.")
        if not text:
            w["error"] = "nothing in focus (page blocked, needs JavaScript, or layout changed)"
            continue
        lines = text.splitlines()
        if "below" in w:
            p = lowest_price(lines)
            if p is not None and p < w["below"] and (w.get("price") is None or p < w["price"]):
                alert(f"Watch: {w['label']} is now {p:g} (limit {w['below']:g}). {w['url']}")
                changed += 1
            if p is not None:
                w["price"] = p
        elif h != w.get("hash"):
            old = set((w.get("last") or "").splitlines())
            new = [l for l in lines if l not in old][:4]
            summary = " | ".join(l.replace("\t", " ")[:90] for l in new) or "content changed"
            alert(f"Watch: {w['label']} changed. New: {summary}. {w['url']}")
            changed += 1
        w["hash"], w["last"] = h, text[:6000]
    return changed


def main(a):
    rows = load()
    cmd = a[0] if a else ""
    if cmd == "add" and len(a) >= 3:
        label, url = a[1][:80], a[2]
        if not ok_url(url):
            sys.exit("url must start with https://")
        w = {"label": label, "url": url, "created": dt.date.today().isoformat(), "focus": parse_focus(opt(a, "--focus"))}
        if opt(a, "--below"):
            w["below"] = float(opt(a, "--below"))
        mode = opt(a, "--render") or "auto"
        if mode not in MODES:
            sys.exit("--render must be auto, always or never")
        if mode != "auto":
            w["render"] = mode
        text, h = snapshot(w)
        w.update(hash=h, last=text[:6000], price=lowest_price(text.splitlines()), checked=now())
        rows.append(w)
        save(rows)
        n = len(rows)
        if w.get("note"):
            print(f"Note: {w['note']}.")
        if not text:
            print(f"{n}. Watching {label}, but nothing is in focus yet. The page may need JavaScript or the focus words miss. Try 'peek {n}'.")
        elif "below" in w:
            print(f"{n}. Watching {label}. Lowest price now: {w['price'] if w['price'] is not None else 'none found'}.")
        else:
            print(f"{n}. Watching {label}. Baseline: {len(text.splitlines())} lines in focus.")
    elif cmd == "list":
        if not rows:
            print("No watches.")
        for i, w in enumerate(rows, 1):
            err = f" [problem: {w['error']}]" if w.get("error") else (f" [note: {w['note']}]" if w.get("note") else "")
            js = ", rendered in Chromium" if w.get("render") == "always" or (w.get("render", "auto") == "auto" and w.get("needs_render")) else ""
            print(f"{i}. {w['label']}{describe(w)}{js} (last checked {w.get('checked', '?')}){err}")
    elif cmd == "remove":
        gone = rows.pop(pick(rows, a))
        save(rows)
        print(f"Removed: {gone['label']}")
    elif cmd == "peek":
        w = rows[pick(rows, a)]
        text, _ = snapshot(w)
        if w.get("note"):
            print(f"Note: {w['note']}.")
        print(text[:3000] or "(nothing in focus)")
        save(rows)
    elif cmd == "check":
        n = check(rows)
        save(rows)
        if not n:
            print("No changes.")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
