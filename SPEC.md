# tot — Build Spec

**Status:** locked design, ready to build. Supersedes the deliberation record at
`~/plannotator/totpage/DESIGN.md` (kept for provenance). No production change until greenlit.

Every claim here was verified against the running platform (`~/oss/workspaces`) and the
architecture of record (`~/oss/infra/research/ARCHITECTURE.md`). Verification notes are at the end.

---

## 1. What tot is

A tiny command-line tool you `npm install`. You run `tot notes.md` (or `tot page.html`) and get a
public link on **tot.page**. Markdown is served as the raw `.md`; HTML is served as the raw `.html`.
It is a **thin client of the existing Workspaces `/v1` API** — it adds **no server code** of its own.
The one piece of new platform work is a small content-serving route (§5), and it reuses machinery that already exists.

It honors the prototype's ergonomics (the `tot <file>` / `list` / `remove` shape, a `~/.tot` config,
the brand). It drops the prototype's backend (its own Worker + KV).

---

## 2. Locked decisions

1. **tot is a thin CLI over `/v1`.** No new Worker, no KV, no schema change, no change to the access
   gate (`resolveAccess`). Publish/delete already work; see §4.
2. **Both markdown and HTML.** Markdown → served raw as `text/markdown`. HTML → served raw as
   `text/html`. The server never renders or transforms the file.
3. **Link is the keys.** An anonymous page is visibility `open`: anyone who has the link can view,
   update, and delete it. No private owner, no token to manage. (This is the platform's existing
   anonymous model — ARCH L378.)
4. **URLs update in place (living).** The link you share is version-less and always shows the latest.
   Re-publishing mints a new version under the hood; the link doesn't change. A frozen, version-pinned
   `@hash` snapshot URL is also available for when you want a permanent capture. See §3.
5. **`tot.page` is the public content origin** — the separate, cookieless domain that serves raw
   files. This resolves the architecture's open "register the content domain" item (D-MD8) and unlocks
   the real firewall + instant cache-purge. See §7 + §8.
6. **List/remove are local.** `tot list` / `tot remove` read a local `~/.tot` registry. Anonymous
   pages have no server-side owner, so the CLI's own record is the source of truth (ARCH L357 §4(4):
   "visited-by-link is never listable").
7. **Anonymous-only at launch.** No login, no accounts, no key-minting in the CLI. (A pre-minted API
   key via `tot login --key` stays as an optional power-user path; it changes nothing here.)

---

## 3. The URL model

Every publish gives you **two** URLs for the same page:

```
LIVING (the one you share):   https://tot.page/{slug}/{file}
FROZEN (a permanent snapshot): https://tot.page/{slug}/{file}@{hash}
```

- `{slug}` is a random ~22-char token (Web-Crypto, not a readable name — custom names are out, ARCH L308).
- `{file}` is the file name (`index.md`, `page.html`, …). `tot.page/{slug}` with no file resolves to
  the workspace's single/primary doc, mirroring `/s/{slug}` (ARCH L314).
- **LIVING**: always serves the latest version. `tot update` mints a new version; this URL follows it.
  Short edge cache (`max-age=60`), cleared instantly on update via tag-purge.
- **FROZEN**: pinned to one version forever, cached indefinitely. Re-publishing never alters it.

This is exactly git: the version-less URL is like a branch tip (moves to the newest commit); the
`@hash` URL is a specific commit (never changes). Both are reads on the content origin; both serve
raw files with the right content type.

---

## 4. CLI surface (every command maps to an existing endpoint)

| Command                  | Real endpoint                                                                                                                  | Behavior                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `tot notes.md`           | `POST /v1/documents {kind:"markdown", body}` → poll `GET .../documents/{docId}` until `version != null` → print the living URL | Anonymous → `open` page. Sends **raw source**; the content origin serves the raw `.md`. Records `{wsId, docId, slug, version, url}` in `~/.tot`. |
| `tot page.html`          | `POST /v1/documents {kind:"html", body}` → same poll                                                                           | HTML served as the raw `.html` on the content origin.                                                                         |
| `tot update <file\|url>` | `PUT /v1/workspaces/{wsId}/documents/{docId}` (raw body)                                                                       | Pushes new content → new version/hash; the living URL now shows it. Resolves `{wsId,docId}` from `~/.tot`.                    |
| `tot list`               | reads `~/.tot`                                                                                                                 | Local record of pages published from this machine.                                                                            |
| `tot remove <file\|url>` | `DELETE /v1/workspaces/{wsId}/documents/{docId}`                                                                               | Hard delete (ARCH L357). Routes through the existing `open → edit → anyone` grant — no gate change. Prune the `~/.tot` entry. |
| `tot login --key <KEY>`  | stores a pre-minted `wsk_live_` key; verify via `GET /v1/me`                                                                   | Optional. Authenticated publishes become `private`+owned. Not required for anything above.                                    |

Notes verified against the platform:

- **Publish is one POST, then a short poll** — seeding the body arms the first checkpoint; no extra
  PUT needed (`document.ts` seed → `applyAgentEdit` → hedge alarm). First version lands in ~2–10s.
- **Body ceiling: 1.5 MB**, enforced server-side with a clear `422` (`MAX_DOCUMENT_BYTES`). The CLI
  surfaces that message; no client-side guess needed.
- **`tot remove` deletes the page's content, not the container.** The empty workspace shell is left
  behind (deleting the container is owner-only; an anonymous one has no owner — ARCH L357). Cleanup of
  empty shells is deferred (§9).
- Dropped prototype flags: `--slug` / `--random` (slugs are server-minted random tokens), `--type text`
  (only `markdown`/`html` kinds exist).

---

## 5. The one piece of new platform work

**A version-less raw-file route on the content (usercontent) Worker.**

Today the content Worker serves only `GET /{slug}/{path}@{sha}` — version-pinned, immutable
(`usercontent/index.ts`). To make the **living** URL in §3 work, add:

```
GET /{slug}[/{path}]   (no @hash)
  → resolve the workspace by slug + the doc's CURRENT head version
  → serve the raw file bytes with content type by kind
  → Cache-Control: public, max-age=60   +   Cache-Tag: ws:{id}
  → gated by the visibility pointer (fail-closed), exactly like /s
```

This is **the content-origin twin of the existing `/s/{slug}` read** (ARCH L375): same slug→head
resolution, same short cache, same `Cache-Tag: ws:{id}` purge-on-update (spike-02 verified ~200ms),
same fail-closed visibility pointer. The only difference: `/s` returns API-shaped data; this returns
the raw file. It reuses the D1 slug lookup and the purge machinery that already exist. **Small, and
consistent with a built pattern — not a new subsystem.**

Effort: **M**. Risk: **Low–Med** (it's a read path on a cookieless origin; the hard parts — purge
and pointer — exist).

---

## 6. Rate limits + takedown

**Firewall rate limits** (Cloudflare dashboard rules on the tot.page zone; tunable starting points,
matched to the platform's existing in-Worker dampers):

| Surface               | Limit (per IP) | Action    |
| --------------------- | -------------- | --------- |
| Viewing pages (reads) | 120 / min      | challenge |
| Publishing a new page | 10 / min       | challenge |
| Updating / deleting   | 60 / min       | challenge |

Reads are the denial-of-wallet vector (each cold view can cost a content-store read), so the read cap
is the one genuinely new control. Create/update caps mirror the existing `CREATE_LIMITER` (10/min) and
`WRITE_LIMITER` (60/min).

**Takedown:** one admin power — the operator can hard-delete **any** page by id (it's your domain;
you must be able to remove illegal/abusive content). Minimal: a script/query, not a system.

---

## 7. tot.page domain decision

`tot.page` becomes the production content origin: set `USERCONTENT_ORIGIN=https://tot.page` in the
app Worker's **production** env block only (staging stays on `*.workers.dev`), plus a Custom Domain
route on the production content Worker. This is config, not code (`config.ts` reads the origin from
env).

- It is a **separate registrable domain** (not a subdomain of the app), so the cookie/SOP isolation
  the content origin exists for still holds. CI assertion: content origin's registrable domain ≠ app
  origin's; the content Worker never sets a cookie.
- It **amends D-MD8**, which today says the content origin is "never a top-level human destination."
  tot deliberately makes it one. Acceptable because the origin is cookieless (nothing to steal); the
  only residual is hosting-abuse, covered by the takedown power. Record this as an explicit amendment,
  not a silent vars change (§8).
- **Non-retrofittable ordering:** lock `tot.page` in **before the first production page is published**
  — every frozen `@hash` URL bakes the origin in permanently.

---

## 8. Architecture-doc updates (apply on greenlight, not before)

- **ARCHITECTURE.md / D-MD8:** content origin resolved to `tot.page`; amend "never a top-level
  destination" to allow tot's public pages (cookieless ⇒ safe; abuse handled by takedown). Record the
  new version-less content route (§5) as the content-origin twin of `/s`.
- **ARCHITECTURE.md / serve-path:** record the living-read cost stance (short cache + purge; content
  reads on cold miss) and that reads are firewall-rate-limited.
- **PRODUCT.md:** add tot as the CLI publishing surface; the published `tot.page` link is the product
  URL; link-is-the-keys (anyone with the link can update/delete); pages are living by default with a
  frozen `@hash` snapshot available.
- **WHAT_MATTERS.md:** the abstract "separate content origin" is now concretely `tot.page`.
- **D3 (link-is-access):** one line — on an `open` page the link grants update + delete, not just
  view; same rule, no gate change.
- **SLICES.md:** add the tot CLI as a client slice + the one platform add (§5) + the launch-blockers.
- **spec.yaml:** no wire change; optional note that tot is a documented client of
  `POST /v1/documents`, `PUT`/`DELETE …/documents/{docId}`, and that anonymous `open` pages never
  appear in `listWorkspaces`.

---

## 9. Work items

| #   | Task                                                                                                          | Where                                                             | Effort | Launch-blocking                   |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ | --------------------------------- |
| 1   | tot CLI: publish (POST→poll), update (PUT), remove (DELETE), `~/.tot` registry, brand. Drop KV/Worker/marked. | `~/oss/totpage` (new `@plannotator/tot`, markdown-editor tooling) | M      | —                                 |
| 2   | Version-less raw-file route on the content Worker (§5)                                                        | `~/oss/workspaces` (usercontent)                                  | M      | **yes** (the living URL needs it) |
| 3   | Point production `USERCONTENT_ORIGIN`→`tot.page` + Custom Domain route; lock before first publish             | workspaces config + Cloudflare                                    | S      | **yes**                           |
| 4   | Firewall rate-limit rules (read/create/update) + cost alert/kill-switch                                       | Cloudflare                                                        | S–M    | **yes**                           |
| 5   | Takedown: admin "delete any page by id"                                                                       | workspaces (ops)                                                  | S      | **yes**                           |
| 6   | Apply the doc updates in §8 (atomically — ARCHITECTURE + PRODUCT must agree)                                  | `~/oss/infra`                                                     | S      | —                                 |
| 7   | Empty-shell cleanup (delete workspaces left with no documents)                                                | workspaces (platform)                                             | S      | no (defer; revisit at volume)     |
| 8   | Old markdown-to-HTML task deleted; tot serves raw files                                                       | workspaces (usercontent)                                          | —      | done                              |

---

## 10. The one divergence from the prototype (stated honestly)

The prototype returned a private `admin_key` saved at `~/.tot`, so only the holder could manage a
page. The platform **removed** any anonymous ownership token (decision D3, "the link is the keys") and
will not reintroduce it (that would touch the access gate). So tot's ownership model is **different
from the prototype's by design**: there is no private admin key — **the link itself is the control.**
Anyone with the link can update or delete. `~/.tot` is just a convenience list of what you published,
not a credential. This is the single intentional departure from the original prototype, and it is
what makes the tool safe to hand to the public.

Everything else honors the prototype: `tot <file>` → a tot.page URL, markdown-or-HTML, list/remove,
cheap on Cloudflare, update-in-place.

---

## 11. Verification notes (checked, not assumed)

- Create response = `share_url` (`/s/{slug}`) + `file_url` (`{content}/{slug}/{path}@{sha}`, null
  until first checkpoint) + `version` (null until checkpoint); no creator_token — `wire.ts:31-54`.
- Anonymous create → `open`; `open` = anyone-with-link view **+ edit** — ARCH L378, `access.ts`.
- Document delete is edit-gated (so link-holders can delete); workspace delete is owner-only, leaving
  anon shells for a deferred reaper — ARCH L357 §4(1).
- `/s/{slug}` is the living slug→head read: cookieless, `public, max-age=60`, NOT immutable, checkpoint-
  fresh, `Cache-Tag: ws:{id}`, JSON|markdown only (no HTML redirect) — `shared.ts`, ARCH L375.
- usercontent serves `@sha` immutable/cache-forever and the version-less living twin; HTML and markdown
  are both raw files — `usercontent/index.ts`.
- Demote/update eviction = visibility pointer (authoritative, fail-closed) + best-effort
  `purgeByTag('ws:'+id)` (~200ms, spike-02) — ARCH L307/324. The living route reuses this.
- `POST /v1/api-keys` is session-cookie-only — a headless CLI can't self-mint a key, hence anonymous-
  only at launch — spec securitySchemes.
- Body ceiling `MAX_DOCUMENT_BYTES` = 1.5 MB, `422` — `core/limits.ts`, `documents.ts`.
- Prototype intent (`tot <file>` → url + manage; raw markdown or HTML; cheap on Cloudflare) —
  `~/plannotator/totpage/original_prompt.md`. The version-less updatable URL matches the prototype's
  mutable-URL mental model; the ownership model is the one deliberate divergence (§10).
