<p align="center">
  <img src="./site/assets/readme/totpage2.webp" alt="tot" width="700">
  <br>
  <sub><a href="https://tot.page">tot.page</a> is what enables <a href="https://plannotator.ai/workspaces">Plannotator Workspaces</a></sub>
</p>

# tot.page

Publish a markdown or HTML file to a live link in one command. No signup.

The useful part is that it is **git-backed publishing**, not a one-off upload. The link you share is
living, like a branch: run `tot update` and the same URL moves forward. Every publish also creates a
real version with a frozen `@hash` URL, like a commit, so you can point people at either "latest" or
"exactly this snapshot."

```bash
npm i -g @plannotator/tot
```

```
tot notes.md
  ↳ https://tot.page/aB3xK9q
  commit  e5f6c1a
  frozen  https://tot.page/aB3xK9q/index.md@e5f6c1a
```

## Commands

| Command                 | What it does                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `tot notes.md`          | Publish markdown as the raw `.md` file.                                                |
| `tot page.html`         | Publish HTML as the raw `.html` file, plus local support files it directly references. |
| `tot update <link>`     | Push new content. The same link updates.                                               |
| `tot list`              | Show what you have published.                                                          |
| `tot remove <link>`     | Remove the living page from its share link.                                            |
| `tot login --key <key>` | Optional. Publish as an owned account instead of anonymous.                            |

## Why it exists

Most "put this online" tools either render your markdown, hide the source behind an app, or give you
a new URL every time you change something. `tot` is deliberately smaller:

- Markdown and HTML are served raw, byte for byte.
- The share link stays stable across updates.
- Each update is still preserved as an immutable version.
- HTML support files next to the page are uploaded first, so real HTML pages keep working.
- No account is needed for the default flow; the link is the key.

## How it works

Files are served byte for byte. Markdown comes back as raw markdown. HTML comes back as raw HTML.

For HTML, `tot` also uploads direct local browser dependencies before the page goes live: images,
stylesheets, scripts, video, `srcset` entries, and video posters. It skips external URLs and ordinary
navigation links. There is no config file, build step, routing layer, or bundler.

Your link is live. Run `tot update` and the same `tot.page/...` link shows the new version. Every version also keeps a frozen `@hash` link that never changes, for when you want a fixed snapshot.

`tot remove` removes the living page. Frozen snapshot links are permanent while the workspace exists.

No accounts, no tokens. The link is the key.

> A page you publish is open. Anyone who has the link can view it, update it, or delete it. There is no private mode. Share the link with that in mind.

## Configuration

State lives in `~/.tot`: the API endpoint and the list of pages you have published. Override the API origin for one run with `--endpoint <url>`.

## Built on

[Cloudflare Artifacts](https://www.cloudflare.com/products/artifacts/). Every version is a real git commit.

## License

MIT
