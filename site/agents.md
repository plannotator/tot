# tot.page — API for agents

Publish a markdown or HTML file to a live, public URL. The `tot` CLI is a thin
wrapper over this API; you can use it directly with `curl`.

- **Base URL:** `https://api.tot.page`
- **Pages are served at:** `https://tot.page/{slug}`
- **Auth:** optional. Send `Authorization: Bearer wsk_live_…` to own your pages.
  With no auth, the page is **`open`** — the link is the key: anyone who has it can
  read, update, or delete it. There is no private mode without a key.

## Core model

- **Files are served raw.** A markdown file comes back as the raw `.md`; an HTML file
  comes back as the raw `.html`. tot does not render or transform anything. (A browser
  may render the HTML on its own; that is the browser, not tot.)
- **HTML support files are assets.** For HTML with direct local browser dependencies,
  upload the support files first, then commit the HTML last. V1 direct refs are
  `src`, `srcset`, `poster`, stylesheet/icon/preload/modulepreload `<link href>`,
  and `<script src>`. Skip external URLs, `data:`, anchors, and ordinary `<a href>`
  navigation links. Root-relative support refs and `<base href>` are unsupported;
  use paths relative to the HTML file.
- **Living vs frozen URLs.** Every publish/update mints a version (a content hash).
    - `share_url` (`https://tot.page/{slug}`) is **living** — always shows the latest.
    - Each version also has a **frozen** `…@{hash}` URL that never changes.
- **Body limit:** 1.5 MB (UTF-8). Over that → `422`.
- **Errors** are JSON: `{ "error": { "code": "...", "message": "..." } }`.

## Publish a page

For markdown and bare HTML with no local refs, use `POST /v1/documents`.

```bash
curl -X POST https://api.tot.page/v1/documents \
  -H 'content-type: application/json' \
  -d '{"kind":"markdown","body":"# Hello\n\nPublished with tot."}'
```

Request: `{ "kind": "markdown" | "html", "body": "<string>", "title"?: "<string>" }`

Response `201`:

```json
{
	"document": {
		"id": "doc_…",
		"workspace_id": "ws_…",
		"doc_path": "index.md",
		"kind": "markdown",
		"version": null,
		"share_url": "https://tot.page/aB3xK9…",
		"file_url": null
	},
	"workspace": {
		"id": "ws_…",
		"slug": "aB3xK9…",
		"share_url": "https://tot.page/aB3xK9…",
		"visibility": "open"
	}
}
```

**`version` is `null` until the first checkpoint lands (~2–10s).** Poll the read
endpoint until `version` is non-null — then the page is live at `share_url`.

For HTML with local refs, use the workspace-first flow:

1. `POST /v1/workspaces`
2. `PUT /v1/workspaces/{wsId}/assets/{assetPath}` for every local support file
3. `POST /v1/workspaces/{wsId}/documents` with the HTML body, last
4. Poll the document read until `version` is non-null

If an asset upload fails, do not commit the HTML. V1 does not delete old unused
assets on update.

Support asset content types:

- `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`
- `text/css`
- `application/javascript`
- `video/mp4`

## Read a page

`GET /v1/workspaces/{wsId}/documents/{docId}`

- `Accept: application/json` (default) → the document object (read `version`, `body`).
- `Accept: text/markdown` → the raw body.

```bash
curl https://api.tot.page/v1/workspaces/$WS/documents/$DOC
```

## Update a page (same link, new content)

Re-scan the local HTML first. Upload new or changed support files with
`PUT /v1/workspaces/{wsId}/assets/{assetPath}`, then update the document last:

`PUT /v1/workspaces/{wsId}/documents/{docId}` — **raw body, not JSON.**

```bash
curl -X PUT https://api.tot.page/v1/workspaces/$WS/documents/$DOC \
  -H 'content-type: text/markdown' \
  --data '# Updated content'
```

- Content-Type: `text/markdown` or `text/html`.
- Optional `If-Match: <version>` → `412` if the page changed under you.
- The living `share_url` reflects the new version within ~60s.

## Remove a page

`DELETE /v1/workspaces/{wsId}/documents/{docId}` → `204` (hard delete, no undo).
On an `open` page, anyone with the link can delete it.

## Identify a key

`GET /v1/me` with `Authorization: Bearer wsk_live_…` → `{ user_id, email?, active_org_id? }`.

## End-to-end (publish, wait, done)

```bash
RESP=$(curl -s -X POST https://api.tot.page/v1/documents \
  -H 'content-type: application/json' -d '{"kind":"markdown","body":"# Hi"}')
WS=$(echo "$RESP"  | jq -r .workspace.id)
DOC=$(echo "$RESP" | jq -r .document.id)
URL=$(echo "$RESP" | jq -r .workspace.share_url)
# poll until checkpointed, then the page is live at $URL
until [ "$(curl -s https://api.tot.page/v1/workspaces/$WS/documents/$DOC | jq -r .version)" != "null" ]; do sleep 2; done
echo "live: $URL"
```

Full interactive reference: <https://tot.page/Z3eA0ZULwEAI66aDByluuQ>
