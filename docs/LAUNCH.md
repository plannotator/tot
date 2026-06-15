# tot — Launch runbook (owner steps)

Everything here needs **your** Cloudflare / npm credentials, so it can't run from an agent
session. The code + config are already done and committed locally (see "What's already done").
Do these in order. Nothing here is reversible-hard except production deploy; staging is safe.

---

## What's already done (no action needed)

- `tot` CLI built + tested (`~/oss/totpage`, 26 tests green).
- Version-less content route built + tested (`~/oss/workspaces`, branch `feat/usercontent-living-route`, usercontent 18 tests green, no regressions).
- Config wired: app production `USERCONTENT_ORIGIN=https://tot.page`; usercontent production has the `tot.page` Custom Domain route.
- Takedown script: `~/oss/workspaces/scripts/takedown.sh`.
- Architecture docs amended (`~/oss/infra`, branch `docs/tot-page-amendments`).

All committed **locally, not pushed**.

---

## Step 0 — Push the code (Claude can do this on your "go")

Pushing `feat/usercontent-living-route` to GitHub triggers CI → **staging** auto-deploy + re-verify.
No production, no real users. This is how the new route goes live on staging to test.
(Merging to main / production deploy is separate and gated.)

---

## Step 1 — Confirm the `tot.page` zone is on Cloudflare

You bought it on Cloudflare, so it should already be an active zone. Grab two things you'll
reuse below:

- **Zone ID** — dash → tot.page → Overview → API section (right side).
- **API token** — dash → My Profile → API Tokens → Create Token → permissions:
  `Zone:Cache Purge:Edit` + `Zone:Zone WAF:Edit` (scoped to tot.page).

---

## Step 2 — Connect `tot.page` to the content Worker (Custom Domain)

The config is already in `apps/usercontent/wrangler.jsonc` (production routes). Deploying production
creates the domain + DNS automatically. **You must do this before the first production page exists**
(the origin is baked into every frozen `@sha` URL).

```bash
cd ~/oss/workspaces/apps/usercontent
wrangler deploy --env production     # creates the tot.page custom domain + DNS
```

(You can test the whole flow on staging first — staging stays on `*.workers.dev`, no custom domain.)

---

## Step 3 — Firewall rate limits

**Precision the SPEC glossed:** the **read** cap lives on the **tot.page** zone (that's where pages are
served). The **publish/update/delete** caps belong on the **app** zone (`workspaces.plannotator.ai`,
where `/v1` lives) — they mirror the in-Worker dampers that already exist. Easiest path for all of them
is the dashboard (Security → WAF → Rate limiting rules); the API version of the new **read** rule:

```bash
# READ cap on the tot.page zone: 120 req/min/IP → managed challenge
curl -X PUT \
  "https://api.cloudflare.com/client/v4/zones/<TOT_PAGE_ZONE_ID>/rulesets/phases/http_ratelimit/entrypoint" \
  -H "Authorization: Bearer <CF_API_TOKEN>" -H "Content-Type: application/json" \
  --data '{
    "rules": [{
      "action": "managed_challenge",
      "expression": "(http.host eq \"tot.page\")",
      "ratelimit": {
        "characteristics": ["ip.src"],
        "period": 60,
        "requests_per_period": 120,
        "mitigation_timeout": 60
      },
      "description": "tot.page read cap 120/min/IP"
    }]
  }'
```

On the **app** zone, add two more the same way (or in the dashboard): publish `POST` to `/v1/documents`
at **10/min/IP**, other `/v1` writes at **60/min/IP**. These just reproduce the existing
`CREATE_LIMITER` / `WRITE_LIMITER` numbers at the authoritative edge.

---

## Step 4 — Cost / spending alert (do this in the dashboard, it's faster)

dash → Manage Account → Billing → **Notifications** → add a **Billing usage alert** at a $ threshold
you're comfortable with. This is your "someone's running up my bill" tripwire while the rate limits
do the front-line work.

---

## Step 5 — Publish the CLI to npm

Current release: `@plannotator/tot@0.1.1`.

Future patch releases use the same flow:

```bash
cd ~/oss/totpage
npm version patch --no-git-tag-version  # or edit package.json deliberately
npm publish --access public
```

Anyone can: `npm install -g @plannotator/tot` → `tot notes.md`.

---

## Using the takedown power

Remove an abusive page by its slug (the part after `tot.page/`):

```bash
cd ~/oss/workspaces
scripts/takedown.sh production <slug>            # dry run — shows what it'd delete
scripts/takedown.sh production <slug> --confirm  # actually delete (cascades)
```

It prints the cache-purge command to evict the cached copy immediately.

---

## Order that matters

1. Push (Step 0) → test on staging.
2. Zone + token (Step 1).
3. **Custom domain (Step 2) BEFORE any production page** — non-retrofittable.
4. Rate limits + cost alert (Steps 3–4) **before** real traffic.
5. npm publish (Step 5) is done for `@plannotator/tot@0.1.1`; repeat only for future patch releases.
