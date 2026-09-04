# HTML with local assets

For HTML that directly references local files. Bare HTML (only external URLs or
inline content) takes the simple flow in SKILL.md instead.

## Scan the HTML first

Direct refs that count as assets:

- `<img src>`, `<img srcset>` entries, `<video src>`, `<video poster>`,
  `<audio src>`, `<source src>` / `<source srcset>`
- `<link href>` for `stylesheet`, `icon`, `preload`, `modulepreload`
- `<script src>`

Leave alone: external URLs (`http://`, `https://`, `//…`), `data:` URIs,
anchors (`#…`), and ordinary `<a href>` navigation links.

Paths must be relative to the HTML file. Root-relative refs (`/img/x.png`) and
`<base href>` are unsupported — rewrite them to file-relative paths before
publishing.

Asset content types: `image/png`, `image/jpeg`, `image/gif`, `image/webp`,
`image/svg+xml`, `text/css`, `application/javascript`, `video/mp4`.

## Publish flow

Assets first, document last — the page goes live referencing the assets, so a
missing one would ship broken. If any asset upload fails, stop before committing
the HTML: V1 never garbage-collects orphaned assets.

```bash
WS=$(curl -sS -X POST https://api.tot.page/v1/workspaces | jq -r .workspace.id)

# one PUT per referenced file — raw bytes, correct content-type,
# URL-encode each path segment
curl -sS -X PUT "https://api.tot.page/v1/workspaces/$WS/assets/logo.svg" \
	-H 'content-type: image/svg+xml' --data-binary @logo.svg -o /dev/null

# document last
HTML=$(jq -Rs '{doc_path: "index.html", kind: "html", body: .}' index.html)
RESP=$(curl -sS -X POST "https://api.tot.page/v1/workspaces/$WS/documents" \
	-H 'content-type: application/json' -d "$HTML")
DOC=$(jq -r .id <<<"$RESP")
```

Assets are served from the living link: `https://tot.page/{slug}/{assetPath}`.

Then pass the checkpoint gate (poll GET until `version` is non-null) and report
`share_url` + `file_url` exactly as in SKILL.md. Done when the page URL and every
asset URL answer `200`.

## Update with assets

Same workspace, same document:

1. Re-scan the new HTML.
2. `PUT` every referenced asset whose bytes changed (same `assets/{assetPath}`
   paths — they replace in place).
3. `PUT` the document body last (`content-type: text/html`; raw body, not JSON).
