# tot.page API reference

Base URL `https://api.tot.page`; pages are served at `https://tot.page/{slug}`.
Auth is optional: send `Authorization: Bearer wsk_live_…` to publish as an owned
account. Without it pages are open — the link is the key (see SKILL.md).

Body limit 1.5 MB (UTF-8) → `422`. Errors are JSON:
`{"error":{"code":"…","message":"…"}}`.

## POST /v1/documents — publish (markdown, or HTML with no local refs)

Request: `{"kind": "markdown" | "html", "body": "<string>", "title"?: "<string>"}`

Response `201` — note the nesting; the document lives under `.document`:

```json
{
	"document": {
		"id": "doc_…",
		"workspace_id": "ws_…",
		"doc_path": "index.md",
		"kind": "markdown",
		"title": null,
		"version": null,
		"share_url": "https://tot.page/{slug}",
		"file_url": null,
		"created_at": "…",
		"updated_at": "…"
	},
	"workspace": { "id": "ws_…", "slug": "…", "share_url": "…", "visibility": "open" }
}
```

`version`/`file_url` are `null` until the first checkpoint lands (~2–10s); poll
the read endpoint below until `version` is non-null.

## GET /v1/workspaces/{wsId}/documents/{docId} — read

Returns the document object **bare** (no `.document` wrapper):

`id, workspace_id, doc_path, kind, title, version, share_url, file_url, body,
created_at, updated_at`

- `Accept: application/json` (default) → the object above.
- `Accept: text/markdown` → the raw body.

This is also the checkpoint poll.

## PUT /v1/workspaces/{wsId}/documents/{docId} — update, same living link

**Raw body, not JSON.**

```bash
curl -sS -X PUT "https://api.tot.page/v1/workspaces/$WS/documents/$DOC" \
	-H 'content-type: text/markdown' --data-binary @notes.md
```

- Content-Type: `text/markdown` or `text/html`.
- Optional `If-Match: <version>` → `412` when the page changed under you.
- Returns the bare document with the new `version` and `file_url`. The living
  `share_url` reflects the new version within ~60s.
- HTML with local refs: upload new/changed assets first — see
  [html-assets.md](html-assets.md).

## DELETE /v1/workspaces/{wsId}/documents/{docId} — remove

`204`, hard delete, no undo. The living link 404s immediately; frozen `@hash`
snapshots stay up for the workspace's lifetime. Open pages: anyone with the
link can delete.

## Workspace endpoints — for HTML with assets

- `POST /v1/workspaces` → `201` with the workspace **nested**:
  `{"workspace": {"id": "ws_…", "slug": "…", "share_url": "…", "visibility": "open"}}`
- `PUT /v1/workspaces/{wsId}/assets/{assetPath}` — raw asset bytes; 200.
- `POST /v1/workspaces/{wsId}/documents` — request
  `{"doc_path": "index.html", "kind": "html", "body": "<string>"}`; `201` with the
  bare document object.

Full asset flow and scanning rules: [html-assets.md](html-assets.md).

## GET /v1/me — identify a key

`Authorization: Bearer wsk_live_…` → `{ "user_id": "…", "email": "…",
"active_org_id": "…" }`. Use to verify a key before relying on it.
