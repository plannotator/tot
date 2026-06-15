# tot.page repo layout

This repo has two jobs:

1. Build the `@plannotator/tot` npm CLI.
2. Hold the editable public-page sources for `tot.page`.

The CLI package is the deployable npm artifact. The public pages are source files that are copied
or embedded into Workspaces before the content worker is deployed.

## Root

Root is for the npm package and top-level project files:

- `src/` - CLI implementation.
- `test/` - CLI tests.
- `package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `vitest.config.ts` - package tooling.
- `README.md`, `LICENSE` - public package metadata.

The npm package only publishes `dist/`; see `package.json` `files`.

## Public page sources

- `site/landing.html` - editable source for the `https://tot.page/` apex landing page.
- `site/api.html` - source for the published API reference page.
- `site/agents.md` - source for the published agent docs page.

`site/landing.html` is embedded into Workspaces at
`/Users/ramos/oss/workspaces/apps/usercontent/src/landing.ts`. Do not hand-edit that generated
file except through the embed/regeneration step.

## Assets

- `site/assets/landing/poster.jpg` - landing-page video poster.
- `site/assets/landing/bg_pingpong.mp4` - landing-page background video.
- `site/assets/landing/totpage.webp` - landing hero image source; Workspaces embeds it and serves it
  at `/tot.webp`.
- `site/assets/readme/totpage2.webp` - GitHub README banner.

The content worker serves the landing media at:

- `/assets/landing/poster.jpg`
- `/assets/landing/bg_pingpong.mp4`

It also keeps `/poster.jpg` and `/bg_pingpong.mp4` as compatibility aliases for the first landing
deploy. R2 object keys stay `landing/poster.jpg` and `landing/bg_pingpong.mp4`.

## Docs

- `docs/SPEC.md` - product/API/build spec.
- `docs/LAUNCH.md` - launch, npm, Cloudflare, and deploy checklist.
- `docs/REPO_LAYOUT.md` - this file.

## No GitHub Actions here

There is no `.github/workflows` directory in this repo right now. The CLI build/test workflow is
local package tooling:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Landing-page deployment is a Workspaces deploy concern:

1. Edit `site/landing.html`.
2. Regenerate `workspaces/apps/usercontent/src/landing.ts` from that file.
3. Upload changed landing media from `site/assets/landing/` to the Workspaces R2 assets bucket.
4. Deploy the Workspaces usercontent worker.

Do not push, publish npm, deploy Workers, or run live `tot update` without explicit approval.
