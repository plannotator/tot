# tot.page — API for agents

Publish a markdown or HTML file to a live, public URL with one HTTP call. The `tot`
CLI is a thin wrapper over this API; you can use it directly with `curl`.

- **Base URL:** `https://api.tot.page`
- **Pages are served at:** `https://tot.page/{slug}`
- **Auth:** optional. Send `Authorization: Bearer wsk_live_…` to own your pages.
  With no auth, the page is **`open`** — the link is the key: anyone who has it can
  read, update, or delete it. There is no private mode without a key.

## Core model

- **Files are served raw.** A markdown file comes back as the raw `.md`; an HTML file
  comes back as the raw `.html`. tot does not render or transform anything. (A browser
  may render the HTML on its own; that is the browser, not tot.)
- **Living vs frozen URLs.** Every publish/update mints a version (a content hash).
  - `share_url` (`https://tot.page/{slug}`) is **living** — always shows the latest.
  - Each version also has a **frozen** `…@{hash}` URL that never changes.
- **Body limit:** 1.5 MB (UTF-8). Over that → `422`.
- **Errors** are JSON: `{ "error": { "code": "...", "message": "..." } }`.

## Publish a page

`POST /v1/documents`

```bash
curl -X POST https://api.tot.page/v1/documents \
  -H 'content-type: application/json' \
  -d '{"kind":"markdown","body":"# Hello\n\nPublished with tot."}'
```

Request: `{ "kind": "markdown" | "html", "body": "<string>", "title"?: "<string>" }`

Response `201`:

```json
{
  "document":  { "id": "doc_…", "workspace_id": "ws_…", "doc_path": "index.md",
                 "kind": "markdown", "version": null,
                 "share_url": "https://tot.page/aB3xK9…", "file_url": null },
  "workspace": { "id": "ws_…", "slug": "aB3xK9…",
                 "share_url": "https://tot.page/aB3xK9…", "visibility": "open" }
}
```

**`version` is `null` until the first checkpoint lands (~2–10s).** Poll the read
endpoint until `version` is non-null — then the page is live at `share_url`.

## Read a page

`GET /v1/workspaces/{wsId}/documents/{docId}`

- `Accept: application/json` (default) → the document object (read `version`, `body`).
- `Accept: text/markdown` → the raw body.

```bash
curl https://api.tot.page/v1/workspaces/$WS/documents/$DOC
```

## Update a page (same link, new content)

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
