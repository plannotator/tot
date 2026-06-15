# tot — Launch runbook (owner steps)

Everything here needs **your** Cloudflare / npm credentials, so it can't run from an agent
session. The staging-backed `tot.page` soft launch is already live; Workspaces production
is still a separate, deliberate bootstrap/deploy/verify pass. Nothing here is reversible-hard
except production deploy.

---

## What's already done (no action needed)

- `tot` CLI built, tested, pushed, and published as `@plannotator/tot@0.1.1`.
- Version-less content route, raw-pipe serving, v5 text mirror, support assets, and MP4 range serving are built, tested, merged, and deployed to the staging-backed `tot.page` / `api.tot.page` soft-launch path.
- Config wired: staging custom domains point `tot.page` at the content worker and `api.tot.page` at the API worker; production config exists but production is not launched.
- Takedown script: `~/oss/workspaces/scripts/takedown.sh`.
- Architecture docs amended (`~/oss/infra`, branch `docs/tot-page-amendments`).

The code repos are on `main`; infra records are local in `~/oss/infra`.

---

## Step 0 — Confirm staging before production

Before any production launch, rerun the staging verifier against both workers.dev and
the product domains:

```bash
cd ~/oss/workspaces
WORKSPACES_API_TOKEN=<staging-api-token> pnpm verify:v5-live -- --env staging --r2-check --repair
WORKSPACES_API_TOKEN=<staging-api-token> pnpm verify:v5-live -- --env staging --tot-page --r2-check --repair
```

Production deploy remains separate and gated.

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

Current published release: `@plannotator/tot@0.1.1`.
Next patch candidate: `@plannotator/tot@0.1.2`, which fixes npm-bin symlink
entrypoint detection so `tot --help` runs when installed globally.

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

1. Confirm staging (Step 0).
2. Zone + token (Step 1).
3. **Custom domain (Step 2) BEFORE any production page** — non-retrofittable.
4. Rate limits + cost alert (Steps 3–4) **before** real traffic.
5. npm publish (Step 5) is done for `@plannotator/tot@0.1.1`; repeat only for future patch releases.
