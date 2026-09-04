---
name: tot
description: >-
    Publish a markdown or HTML file to a live public tot.page URL — a living link
    plus immutable @hash snapshots — then update or remove it, with curl alone or
    via the tot CLI. Use when asked to publish, share, host, or put online a
    document, report, or page, to update or delete an existing tot.page link, or
    whenever tot or tot.page comes up.
---

# tot — publish a file to a live link

One local file becomes one public URL. No signup, no install — `curl` is enough
(the `tot` CLI, when present, makes the same calls for you). Files are served
raw: markdown comes back as raw `.md`, HTML as raw `.html`, byte for byte. No
config, no build step.

Every page has two URLs:

- **living** — `https://tot.page/{slug}`, always shows the latest version.
- **frozen** — `…/{path}@{hash}`, one immutable snapshot per publish, for
  pointing at "exactly this version".

## The rules that bite

- **Checkpoint gate.** A fresh page answers `version: null` until its first git
  checkpoint lands (~2–10s). Poll the read endpoint until `version` is
  non-null — the link 404s until then. A publish is done when the poll passes,
  not when the POST returns.
- **Open pages.** Without an API key every page is open: anyone holding the link
  can read, update, or delete it. Publish content you mean to be public, and
  treat each link as the credential it is.
- **1.5 MB body limit** (UTF-8) — over it the API answers `422`. Errors are
  JSON: `{"error":{"code":"…","message":"…"}}`.

## Route: CLI or curl

```bash
command -v tot
```

- **found** → use the CLI; it scans HTML assets, waits out the checkpoint, and
  tracks published pages in `~/.tot` across sessions:
  `tot <file>` publish · `tot update <file|url>` · `tot remove <file|url>` · `tot list`
- **not found** → the curl flows below; identical capability, zero install.

## Publish (markdown, or HTML with no local refs)

```bash
BODY=$(jq -Rs '{kind: "markdown", body: .}' notes.md) # HTML → kind: "html"
RESP=$(curl -sS -X POST https://api.tot.page/v1/documents \
	-H 'content-type: application/json' -d "$BODY")
WS=$(jq -r .workspace.id <<<"$RESP") # the page's identity — keep it
DOC=$(jq -r .document.id <<<"$RESP") # for update/remove — keep it
```

`jq -Rs` JSON-encodes the file safely; hand-writing `body` breaks on newlines
and quotes. HTML with local file references takes the asset flow instead — see
Branches below.

Pass the checkpoint gate, then report both URLs:

```bash
until PAGE=$(curl -sS "https://api.tot.page/v1/workspaces/$WS/documents/$DOC") \
	&& [ "$(jq -r .version <<<"$PAGE")" != "null" ]; do sleep 2; done
jq -r '"living: \(.share_url)\nfrozen: \(.file_url)"' <<<"$PAGE"
```

Done when both URLs are in hand and given to the user. `$WS` and `$DOC` are the
page's identity for every later update or remove — keep them for the session;
across sessions, note them next to the source file, or switch to the CLI, which
records them in `~/.tot`.

## Branches

- **HTML referencing local files** (images, stylesheets, scripts, video) —
  upload assets before the document:
  [references/html-assets.md](references/html-assets.md)
- **Update · remove · key auth · full endpoint reference** —
  [references/api.md](references/api.md)
