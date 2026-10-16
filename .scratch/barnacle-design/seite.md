# seite — Verified Reference

All facts below come from observed command output on this machine or from fetched
official docs. Sources are marked `[observed]` / `[docs: URL]`.

`seite` is **not** on `PATH` in this environment. Use the absolute path.

- **Binary:** `D:\sdk\seite\seite.exe` (22,420,992 bytes, only file in that directory — no bundled docs/templates/examples on disk)
- **Path probe:** `where.exe seite` → `INFO: Could not find files for the given pattern(s).` `[observed]`
- **Version:** `seite --version` → `seite 0.20.1` `[observed]`
- **Description:** `A static site generator with LLM integration` `[observed]`
- **Not installed:** `gh` (GitHub CLI) is absent. `npm`/`pnpm`/`cargo`/`go`/`bun`/`nu` exist. `[observed]`

Install (per docs): Windows `irm https://seite.sh/install.ps1 | iex`; Linux/macOS `curl -fsSL https://seite.sh/install.sh | sh` (installs to `~/.local/bin`); or `cargo install seite`. `[docs: https://seite.sh/docs/getting-started]`

## 1. Full command surface

Top-level `seite --help` lists these commands `[observed]`:

`init`, `new`, `build`, `check`, `serve`, `deploy`, `agent`, `collection`, `contact`, `access`, `skill`, `theme`, `workspace`, `upgrade`, `self-update`, `mcp`, `perf`, `completions`, `telemetry`, `help`

> Note: the CLI-reference doc claims "eighteen subcommands" and omits `contact` from its table. The binary has 19 and includes `contact`. Trust the binary. `[observed]` vs `[docs: https://seite.sh/docs/cli-reference]`

### Global flags (every command) `[observed]`

| Flag | Meaning |
|---|---|
| `-v, --verbose` | Debug logging + per-step build timings |
| `--json` | Exactly one JSON document on stdout, human output on stderr. **Not supported by** `serve`, `agent`, `mcp`, `completions`, `self-update` |
| `-y, --yes` | Never prompt; accept defaults (also `SEITE_YES=1`) |
| `-c, --config <CONFIG>` | Path to the project's `seite.toml`. **Custom config file names are not supported** |
| `-d, --dir <DIR>` | Project directory |
| `-s, --site <SITE>` | Target a specific site in a workspace |
| `-h, --help` | Help |
| `-V, --version` | Version |

JSON envelope `[observed]`:
- success: `{"ok":true,"command":"build","data":{...},"warnings":[]}`
- failure: `{"ok":false,"command":..,"error":{"message":..,"chain":[..]}}`

### `init` — Create a new site project `[observed]`

```
Usage: seite.exe init [OPTIONS] [NAME]
Arguments: [NAME]  Name of the site / directory to create
  --title <TITLE>
  --description <DESCRIPTION>
  --deploy-target <DEPLOY_TARGET>   github-pages, cloudflare, netlify; required when not interactive
  --collections <COLLECTIONS>       comma-separated: posts,docs,pages,trust
  --trust-company <TRUST_COMPANY>   defaults to --title
  --trust-frameworks <TRUST_FRAMEWORKS>  soc2,iso27001,gdpr,hipaa,pci-dss,ccpa,soc3
  --trust-sections <TRUST_SECTIONS>      overview,certifications,subprocessors,faq,disclosure,dpa,changelog
  --contact-provider <CONTACT_PROVIDER>  formspree, web3forms, netlify, hubspot, typeform
  --contact-endpoint <CONTACT_ENDPOINT>
  --agents <LIST>                   claude,codex,opencode,cursor, or all. Default: all
```

There is **no separate "blog"/"docs" preset flag** — the shape of the site comes from
`--collections`. `--deploy-target github-pages` is what produces the GitHub Pages preset
(config target + `.github/workflows/deploy.yml`). `[observed]`

> CLI-reference doc says `--collections` accepts `posts,docs,pages,changelog,roadmap`; the
> 0.20.1 binary's help adds `trust` and omits `changelog`/`roadmap` (both are addable later
> via `seite collection add`). `[observed]`

### `new` — Create new content `[observed]`

```
Usage: seite.exe new [OPTIONS] <COLLECTION> <TITLE>
  -t, --tags <TAGS>   comma-separated
      --draft
      --lang <LANG>   appends language suffix to filename; needs [languages.<code>] in config
```
Singular and plural both work (`new post` / `new posts`) — normalized automatically. `[docs: https://seite.sh/docs/collections]`

### `build` — Build the site `[observed]`

```
Usage: seite.exe build [OPTIONS]
      --drafts   Include draft content
      --strict   Treat broken internal links and missing assets as build errors
```

### `check` — Validate without building `[observed]`

```
Usage: seite.exe check [OPTIONS]
      --strict        Fail on warnings too (unknown config keys, broken links)
      --drafts        Include draft content
      --hook <AGENT>  Turn-end hook mode: claude, codex, cursor, opencode
```
Renders into a temp dir; never touches `dist/`. Exit 0 = clean, 1 = problems.
Diagnostic codes are stable: `config-invalid`, `config-unknown-key`, `frontmatter-missing`,
`frontmatter-parse`, `content-invalid`, `shortcode-syntax`, `shortcode-unknown`,
`shortcode-render`, `data-file-parse`, `data-conflict`, `url-collision`, `template-parse`,
`template-render`, `i18n-partial`, `broken-link`, `missing-asset`, `build-failed`. `[docs: https://seite.sh/docs/cli-reference]`

### `serve` — Dev server `[observed]`

```
      --host <HOST>   default 127.0.0.1; 0.0.0.0 for network access
  -p, --port <PORT>   auto-finds a free port if the default is taken
      --build         Build before serving
      --open          Open in default browser
      --no-repl       Don't read stdin commands; serve until interrupted
```
Default port `3000`. `--json` is not supported here. REPL commands: `new`, `agent`, `theme`, `build`, `status`, `stop`. `[observed]` + `[docs: https://seite.sh/docs/cli-reference]`

### `deploy` — Deploy to a hosting provider `[observed]`

```
Usage: seite.exe deploy [OPTIONS]
  -t, --target <TARGET>      Override: github-pages, cloudflare, netlify
      --build                Build before deploying
      --dry-run              Show what would be done without deploying
      --preview              Deploy to preview/staging instead of production
      --base-url <BASE_URL>  Override base_url for this deploy
      --setup                Guided setup: create project, configure CI, set domain
      --domain <DOMAIN>      Set up a custom domain
      --verify               Verify deployment after it completes
      --skip-checks          Skip pre-flight checks
      --no-commit            Skip auto-commit and push (overrides deploy.auto_commit)
```
Only **three** targets exist: `github-pages`, `cloudflare`, `netlify`.

**Required credentials by target** `[docs: https://seite.sh/docs/deployment]`:
- `github-pages` — none beyond a git repo with an `origin` remote (uses git push to `gh-pages`). No token flag.
- `cloudflare` — `npm install -g wrangler` + `wrangler login`.
- `netlify` — `npm install -g netlify-cli` + `netlify login`.

### Remaining commands `[observed]`

| Command | Subcommands / notable flags |
|---|---|
| `agent [PROMPT]` | `--once`, `--with <HARNESS>` (claude, codex, opencode, cursor; defaults to `SEITE_AGENT` else `claude`) |
| `collection` | `add <NAME>` (presets: posts, docs, pages, changelog, roadmap, trust), `list` |
| `contact` | `setup` (`--provider`, `--endpoint`, `--region`, `--redirect`, `--subject`), `remove`, `status` |
| `access` | `groups`, `set-password [GROUP]` — Cloudflare Pages password groups |
| `skill` | `install <SOURCE> [--name]`, `list`, `remove <NAME>`, `update [NAME]` |
| `theme` | `list`, `apply <NAME>`, `create <PROMPT>`, `install <URL> [--name]`, `export <NAME> [--description]` |
| `workspace` | `init [NAME]`, `list`, `add <NAME> [--path --title --collections]`, `status` |
| `upgrade` | `--force`, `--check`, `--agents <LIST>` |
| `self-update` | `--target-version <V>`, `--check` |
| `perf [URL]` | `--strategy <mobile\|desktop>` (default mobile), `--key <PSI_API_KEY>` |
| `completions <SHELL>` | bash, elvish, fish, powershell, zsh |
| `telemetry` | `status`, `on`, `off` — **enabled by default (opt-out)** `[observed: "Telemetry is enabled (default (opt-out))."]` |
| `mcp` | stdio JSON-RPC MCP server (auto-spawned by agents) |

## 2. Config file

**Name/location:** `seite.toml` at the project root. Custom filenames are explicitly
unsupported (`--config` only points at a `seite.toml`). `[observed]`

**Second file — `.seite/config.json`** (project metadata, managed by `seite`, not hand-edited) `[observed]`:
```json
{
  "version": "0.20.1",
  "initialized_at": "2026-10-16T04:35:00.917076600+00:00",
  "agents": ["claude"],
  "hooks_installed": ["claude"]
}
```

### Full option list

**`[site]`** `[docs: .../configuration]`

| Field | Type | Default |
|---|---|---|
| `title` | string | required |
| `description` | string | `""` |
| `base_url` | string | `"http://localhost:3000"` |
| `language` | string | `"en"` |
| `author` | string | `""` |

**`[[collections]]`** — `name` (required), `label`, `directory`, `url_prefix`,
`default_template`, `has_date`, `has_rss`, `listed`, `private`, `access_group`, `nested`,
`paginate`, `subdomain`, `subdomain_base_url`, `deploy_project` `[docs + observed]`

**`[build]`** — `output_dir` (`dist`), `content_dir` (`content`), `template_dir` (`templates`),
`static_dir` (`static`), `data_dir` (`data`), `public_dir` (`public`), `minify` (false),
`fingerprint` (false), `math` (false), `mermaid` (false) `[observed defaults from generated file + docs]`

> `content_dir`, `template_dir`, `static_dir` appear in the generated `seite.toml` but are
> **not** in the docs table for `[build]`. Both sources agree on `output_dir`, `data_dir`,
> `public_dir`, `minify`, `fingerprint`, `math`, `mermaid`. `[observed]`

**`[deploy]`** — `target` (default `"github-pages"`), `repo` (auto-detected), `project`
(auto-detected), `auto_commit` (true), plus `domain` when set. `[docs + observed]`

**`[languages.<code>]`** — `title`, `description` overrides. `[observed: empty table generated]`

**`[images]`** — `widths` (`[480,800,1200]`), `quality` (80), `webp` (true), `avif` (false),
`avif_quality` (70), `lazy_loading` (true). Remove the section entirely to disable processing. `[docs]`

**`[analytics]`** — `provider` (`google`/`gtm`/`plausible`/`fathom`/`umami`), `id`,
`cookie_consent` (false), `script_url`, `extensions`. `[docs]`

**`[access]`** — `mode` (`"password"`, only supported mode), `session_hours` (168, range 1–8760).
Cloudflare Pages only. `[docs]`

**`[trust]`** — `company`, `frameworks` `[observed]`

**`seite-workspace.toml`** (multi-site root only) — `[workspace]` (`name`, `shared_data`,
`shared_static`, `shared_templates`), `[[sites]]` (`name`, `path`, `base_url`, `output_dir`),
`[cross_site]` (`unified_sitemap`, `cross_site_links`, `unified_search`). `[docs]`

### Realistic example config

This is the file `seite init` actually generated (probe project), plus the documented
optional sections:

```toml
[site]
title = "Probe Site"
description = "Probe"
base_url = "http://localhost:3000"   # set to production URL before deploying
language = "en"
author = ""

[[collections]]
name = "posts"
label = "Posts"
directory = "posts"
has_date = true
has_rss = true
listed = true
url_prefix = "/posts"
nested = false
default_template = "post.html"
# paginate = 10

[[collections]]
name = "docs"
label = "Documentation"
directory = "docs"
has_date = false
has_rss = false
listed = true
url_prefix = "/docs"
nested = true
default_template = "doc.html"

[[collections]]
name = "pages"
label = "Pages"
directory = "pages"
has_date = false
has_rss = false
listed = false
url_prefix = ""
nested = false
default_template = "page.html"

[[collections]]
name = "trust"
label = "Trust Center"
directory = "trust"
has_date = false
has_rss = false
listed = true
url_prefix = "/trust"
nested = true
default_template = "trust-item.html"

[build]
output_dir = "dist"
content_dir = "content"
template_dir = "templates"
static_dir = "static"
data_dir = "data"
public_dir = "public"
minify = true
fingerprint = false
# math = false
# mermaid = false

[deploy]
target = "github-pages"
auto_commit = true

[languages]
# [languages.es]
# title = "Mi Sitio"

[images]
widths = [480, 800, 1200]
quality = 80
lazy_loading = true
webp = true
avif_quality = 70

[trust]
company = "Probe Site"
frameworks = ["soc2"]

# [analytics]
# provider = "plausible"
# id = "example.com"
# cookie_consent = false
```

> Caveat: the generated `[images]` block writes `avif_quality = 70` but not `avif = true`.
> This is verbatim generator output. `[observed]`

## 3. Directory layout

`seite init` created exactly this (probe project, `--collections posts,docs,pages,trust --agents claude`) `[observed]`:

```
probe/
├── seite.toml                   # site configuration
├── AGENTS.md                    # 14011 bytes — full site docs for all coding agents
├── CLAUDE.md                    # 11 bytes, just "@AGENTS.md"
├── .gitignore                   # "/dist" and "/dist-subdomains"
├── .mcp.json                    # {"mcpServers":{"seite":{"command":"seite","args":["mcp"]}}}
├── .seite/
│   └── config.json              # project metadata (version, agents, hooks)
├── .github/
│   └── workflows/
│       └── deploy.yml           # GitHub Pages workflow (801 bytes)
├── .claude/
│   ├── settings.json            # permissions + Stop hook
│   ├── rules/                   # config-reference.md, data-files.md, design-prompts.md,
│   │                            # features.md, i18n.md, private-collections.md,
│   │                            # seo-requirements.md, shortcodes.md, templates.md,
│   │                            # trust-center.md
│   └── skills/                  # brand-identity/, landing-page/, seite/, theme-builder/
├── content/
│   ├── posts/
│   │   └── 2026-10-16-hello-world.md
│   ├── docs/                    # empty until you add content
│   ├── pages/                   # empty until you add content
│   └── trust/
│       ├── security-overview.md
│       ├── vulnerability-disclosure.md
│       └── certifications/
│           └── soc2.md
├── templates/
│   ├── base.html                # 27632 bytes — the theme (all 10 bundled themes replace only this)
│   ├── index.html
│   ├── post.html
│   ├── doc.html
│   ├── page.html
│   ├── trust-index.html
│   └── trust-item.html
├── data/
│   └── trust/
│       ├── certifications.yaml
│       ├── faq.yaml
│       └── subprocessors.yaml
├── public/                      # root-level files copied to dist/ WITHOUT prefix
├── static/                      # copied as-is to dist/static/
└── dist/                        # build output (gitignored; absent until first build)
```

Directory roles `[docs + observed]`:
- `content/<collection>/` — markdown + YAML frontmatter
- `templates/` — Tera templates; `templates/shortcodes/` for custom shortcodes; `templates/themes/` for installed themes
- `static/` — copied verbatim to `dist/static/`
- `public/` — copied to the **root** of `dist/` (favicon.ico, `.well-known/`, `_redirects`); observed: `favicon.ico` landed at `dist/favicon.ico`
- `data/` — YAML/JSON/TOML, exposed as `{{ data.<stem> }}`; nested dirs → nested keys
- `dist/` — build output. Subdomain collections go to `dist-subdomains/<name>/`
- `.claude/`, `.cursor/`, `.codex/`, `.agents/`, `.seite/` — coding-agent scaffolding, not build inputs

## 4. Content authoring format

**Markdown + YAML frontmatter only.** Confirmed empirically: adding
`content/pages/raw.html`, `content/pages/mdx.mdx`, and `content/pages/plain.txt` produced
`✓ No problems found` from `seite check` and they were **silently ignored** by the build
(collection counts and output filenames unchanged). No MDX, no raw HTML content files,
no other template/markup source format. `[observed]`

- Markdown flavor: CommonMark-ish; `<!-- more -->` marks the excerpt boundary (else first paragraph). `[observed AGENTS.md]`
- **Templating engine: Tera** (Jinja2-compatible) for `templates/*.html`. `[observed: file header "templates/... — Tera (Jinja2-compatible) HTML templates"]`
- Syntax highlighting is automatic for fenced code blocks with a language annotation. `[observed: output contained `<pre style="background-color:#2b303b;">`]`
- Shortcodes: inline self-closing `{{< name(args) >}}` (youtube, vimeo, gist, figure, `contact_form()`); body form `{{% name(args) %}}...{{% end %}}` (callout: info/warning/danger/tip). **No Hugo-style `{{< /name >}}`.** Custom ones = Tera templates in `templates/shortcodes/`. `[observed .claude/rules/shortcodes.md]`
- Math via `[build] math = true` (server-side KaTeX); Mermaid via `[build] mermaid = true`. `[docs]`

### Frontmatter fields `[observed AGENTS.md + docs]`

| Field | Required | Purpose |
|---|---|---|
| `title` | yes | Page title |
| `date` | dated collections | `YYYY-MM-DD`; also parsed from `YYYY-MM-DD-slug.md` filename |
| `description` | no | meta/OG/Twitter/JSON-LD |
| `image` | no | social preview image (og:image / twitter:image) |
| `updated` | no | last-modified → JSON-LD `dateModified`, sitemap `lastmod` |
| `tags` | no | list; generates `/tags/<slug>/` pages |
| `draft` | no | excluded unless `--drafts` |
| `slug` | no | override auto slug |
| `template` | no | override collection default template |
| `robots` | no | per-page robots meta |
| `weight` | no | sort order for non-date collections (lower first) |
| `aliases` | no | old URLs that redirect here |
| `extra` | no | arbitrary map → `{{ page.extra.x }}` |

### Concrete example file

`content/posts/2026-10-16-hello-world.md` — generated verbatim by `seite init` `[observed]`:

```markdown
---
title: Hello World
date: 2026-10-16
description: Welcome to your new site!
tags:
- intro
---

Welcome to your new site built with **seite**.

Edit this post or create new ones with `seite new post "My Post"`.
```

And `seite new post "Tagged Post" -t rust,web --draft` generated `[observed]`:

```markdown
---
title: Tagged Post
date: 2026-10-16
tags:
- rust
- web
draft: true
---

Write your content here.
```

Templates use Tera and extend `base.html`; content must be emitted with the `safe` filter.
`templates/post.html`, observed in full:

```html
{% extends "base.html" %}
{% block title %}{{ page.title }} - {{ site.title }}{% endblock %}
{% block content %}
<article>
    <h1>{{ page.title }}</h1>
    {% if page.date %}<time>{{ page.date }}</time>{% endif %}
    {% if page.reading_time %}<span class="reading-time">{{ page.reading_time }} {{ t.min_read }}</span>{% endif %}
    {% if page.tags | length > 0 %}
    <div class="tags">
        {% for tag in page.tags %}<a href="{{ lang_prefix }}/tags/{{ tag | slugify }}/">{{ tag }}</a> {% endfor %}
    </div>
    {% endif %}
    <div class="content">{{ page.content | safe }}</div>
</article>
{% endblock %}
```

Overridable blocks: `title`, `head`, `extra_css`, `extra_js`, `header`, `content`, `footer`. `[observed .claude/rules/templates.md]`

### Routing / URL derivation `[observed]`

- URL ⇒ file: `/{url_prefix}/{slug}` → `dist/{url_prefix}/{slug}.html`, **plus** a `.md` twin.
- `pages` has an empty `url_prefix`, so `/about` → `dist/about.html`.
- Clean URLs, no `.html` extension in links.
- Nested collections (`docs`, `trust`) map subdirectories to path segments: `content/trust/certifications/soc2.md` → `/trust/certifications/soc2`.
- Collection index → `dist/<prefix>/index.html`; homepage → `dist/index.html`.
- Tags: `dist/tags/index.html` + `dist/tags/<tag-slug>/index.html`.
- Pagination (`paginate = N` on a collection): `/blog/`, `/blog/page/2/`, … with `pagination.current_page|total_pages|prev_url|next_url`.
- i18n: `about.es.md` → `/es/about`; other languages get a `/{lang}/` prefix.
- Collection index custom content: `content/<collection>/index.md`; homepage content: `content/pages/index.md`. `extra.redirect_to` makes the collection index an instant redirect (a `url-collision` error is the failure code if two pages resolve to one URL).
- Relative `.md` links between content files (`[intro](../docs/intro.md)`) are rewritten to published URLs and validated.

### Nested sections/collections

Yes. Two distinct mechanisms: `nested = true` on a collection turns subdirectories into URL
segments/sidebar groups; and you can add whole new collections via `seite collection add
<posts|docs|pages|changelog|roadmap|trust>` — verified: it appended a new `[[collections]]`
block for `changelog` and created `content/changelog/`. `[observed]`

Collection presets `[docs: .../collections]`:

| Preset | Directory | Dated | RSS | Listed | Nested | URL |
|---|---|---|---|---|---|---|
| posts | `content/posts/` | yes | yes | yes | no | `/posts/slug` |
| docs | `content/docs/` | no | no | yes | yes | `/docs/slug` |
| pages | `content/pages/` | no | no | no | no | `/slug` |
| changelog | `content/changelog/` | yes | yes | yes | no | `/changelog/slug` |
| roadmap | `content/roadmap/` | no | no | yes | no | `/roadmap/slug` |
| trust | `content/trust/` | no | no | yes | yes | `/trust/slug` |

## 5. Build output

Output dir: **`dist/`** (`[build] output_dir`). A successful build is **atomic**: it renders
into a temp staging dir and swaps it in only on full success, so a failed build leaves the
previous `dist/` intact. `[docs]` + observed staging behavior in timings (`Clean output`).

Actual `dist/` after building the probe site `[observed]`:

```
dist/
├── index.html            23408 b   # homepage
├── 404.html              22701 b
├── feed.xml                        # RSS
├── atom.xml                        # Atom
├── sitemap.xml
├── robots.txt                      # includes AI-crawler allow/deny directives
├── llms.txt                        # LLM summary
├── llms-full.txt                   # full markdown with source URLs
├── search-index.json               # always generated, no config needed
├── favicon.ico                     # from public/
├── about.html / about.md           # from content/pages/about.md
├── posts/
│   ├── index.html / index.md
│   ├── hello-world.html / hello-world.md
│   └── code.html / code.md
├── docs/
│   └── index.html / index.md
├── tags/
│   ├── index.html
│   └── intro/index.html
├── trust/
│   ├── index.html / index.md
│   ├── security-overview.html / security-overview.md
│   ├── vulnerability-disclosure.html / vulnerability-disclosure.md
│   └── certifications/soc2.html / soc2.md
└── static/            # static/ copied verbatim (or fingerprinted)
```

Observed `--json` build result `[observed]`:
```json
{"ok":true,"command":"build","data":{"output_dir":"...\\dist","collections":{"docs":1,"posts":2,"pages":1,"trust":3},"pages_written":7,"static_files_copied":3,"public_files_copied":1,"data_files_loaded":3,"duration_ms":109,"timings_ms":{...},"links_checked":86,"broken_links":[...],"missing_assets":[],"subdomains":[],"warnings":[...],"diagnostics":[]},"warnings":[]}
```

Broken-link reporting is precise — observed:
```json
{"target":"/posts/nope","kind":"page","sources":["content/posts/2026-10-16-code.md:11"],
 "suggestion":"/posts/code","source":"content/posts/2026-10-16-code.md","line":11}
```
and human output:
```
⚠ Found 1 broken internal link (1 broken target)
ℹ   /posts/nope (linked from 1 file) — did you mean /posts/code?
ℹ     - content/posts/2026-10-16-code.md:11
```

**Is it a plain static directory usable as a Pages artifact? Yes.** It is pure
HTML/MD/XML/JSON/ICO plus `static/`. The generated workflow uploads `dist` directly with
`actions/upload-pages-artifact@v3`. `[observed]`

## 6. GitHub Actions / GitHub Pages

Yes — **built-in workflow generation**. `seite init --deploy-target github-pages` wrote
`.github/workflows/deploy.yml` (801 bytes) verbatim `[observed]`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install seite
        run: curl -fsSL https://seite.sh/install.sh | sh

      - name: Build site
        run: seite build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

Docs confirm this is the recommended path: "When you run `seite init` with
`--deploy-target github-pages`, a GitHub Actions workflow is generated at
`.github/workflows/deploy.yml` that builds and deploys on every push to `main`."
`[docs: https://seite.sh/docs/deployment]`

Two GitHub Pages paths exist:
1. **Actions artifact path** (above) — no local push needed; requires the repo's Pages source set to "GitHub Actions".
2. **`gh-pages` branch path** — `seite build && seite deploy` pushes `dist/` to `gh-pages`. Observed `deploy --dry-run` output shows the plan:
```
ℹ Dry run: would deploy to github-pages
Pre-flight checks
  ✓ Output directory: ...\dist
  ✗ Base URL: base_url is 'http://localhost:3000' — this will produce broken canonical/OG URLs ...
  ✗ Git repository: not a git repository — run `git init` first
  ✗ Git remote: no remote 'origin' — set deploy.repo in seite.toml or run `git remote add origin <url>`
ℹ   Repository: (auto-detect from git remote)
ℹ   Branch: gh-pages (force push)
ℹ   Files: .nojekyll (auto-generated)
✓ Dry run complete (no changes made)
```
So the `gh-pages` path force-pushes to `gh-pages` and auto-generates `.nojekyll`. `[observed]`

Deploy behavior `[docs: https://seite.sh/docs/deployment]`:
- `auto_commit = true` by default → deploy commits + pushes before building/deploying.
- Branch-based preview: deploying from any branch other than `main`/`master` automatically uses preview mode.
- Pre-flight checks verify output dir exists, `base_url` is not localhost, required CLI tools are present, and platform config is valid.
- `seite deploy --domain example.com` prints DNS records, updates `base_url` + `deploy.domain`, and auto-generates a `CNAME` on the next deploy.
- **GitHub Pages does not support per-collection subdomains** — Cloudflare/Netlify only.
- Deployment pre-flight **rejects password-enabled sites on GitHub Pages or Netlify** (`[access]` is Cloudflare-only).

## 7. Asset pipeline, highlighting, plugins/themes

**Asset pipeline — yes, built in** `[docs + observed]`:
- `minify = true` strips CSS/JS comments and collapses whitespace. Observed: source
  `/* a comment */\n.x {\n  color : blue ;\n}\n` → output `.x{color:blue;}`. Only CSS/JS are
  minified; images/other files are copied.
- `fingerprint = true` adds content hashes and writes `dist/asset-manifest.json`. Observed:
  `dist/static/` contained **both** `main.css` and `main.160df1ee.css`, `app.js` and
  `app.ae3fca0d.js`, with manifest:
  ```json
  {"/static/app.js":"/static/app.ae3fca0d.js","/static/main.css":"/static/main.160df1ee.css"}
  ```
  Note `app.js` was renamed `ae3fca0d.js` even though `static/app.js` was never referenced
  from a template — all static files get fingerprinted.
- **No Sass/SCSS/PostCSS preprocessor** — deliberate. Theme CSS lives inline in the Tera
  template so themes are single self-contained files. Compile Sass externally into `static/`
  if needed. `[docs: .../configuration#css-processing]`
- Image pipeline via `[images]`: resize to `widths`, WebP/AVIF variants, `srcset` +
  `<picture>` rewriting, `loading="lazy"` (first image per page exempted for LCP). Skipped for
  protected trees. `[docs + observed: "Process images" build step]`

**Syntax highlighting — yes, automatic**, no config or plugin. Fenced code blocks with a
language annotation render pre-highlighted with inline token styles. Observed output for a
`rust` fence: `<pre style="background-color:#2b303b;">`. `[observed]`

**Plugins: none.** No plugin system was found in any help output or documentation. Features
are built in. Extension points instead are: themes, custom shortcodes
(`templates/shortcodes/*.html`), data files, and template overrides. `[observed]`

**Themes — yes, first-class.** `seite theme list` showed 10 bundled themes compiled into the
binary `[observed]`:
`default`, `minimal`, `dark`, `docs`, `brutalist`, `bento`, `landing`, `terminal`, `magazine`, `academic`
Preview gallery: https://seite.sh/docs/theme-gallery

Applying a theme **overwrites `templates/base.html` only**; collection templates
(`post.html`, `doc.html`, `page.html`, `trust-item.html`, …) are separate and survive.
Installed themes live in `templates/themes/` as `.tera` files (`theme install <url>`,
`theme export <name>`). `theme create "<prompt>"` generates a `base.html` via Claude Code.
`[observed + docs]`

Additional built-ins: `check` validation with stable diagnostic codes, MCP server
(`seite mcp`), `llms.txt`/`llms-full.txt` LLM discovery files, `markdown` twins for every
page, `robots.txt` AI-crawler management, client-side search index, contact forms
(Formspree/Web3Forms/Netlify/HubSpot/Typeform), Cloudflare Pages password access
(`_worker.js`), multi-site workspaces, i18n, `perf` PageSpeed Insights audit.

## 8. Could NOT determine

1. **Interactive `seite init` prompt flow** — the actual TUI question wording and default
   values. All probing was non-interactive. `--yes` behavior with a missing required
   `--deploy-target` was not exercised.
2. **The complete `seite.toml` schema, authoritatively** — no `--schema`/`--dump-config`
   flag exists. The option list above is the union of the generated file and the docs page.
   It is possible undocumented keys exist. Notably, the docs `[build]` table omits
   `content_dir`/`template_dir`/`static_dir` that the generator writes, so at least one of the
   two sources is incomplete.
3. **Whether `[build] fingerprint = true` also rewrites asset references inside `base.html`
   / user templates** — the manifest was written and files were hashed, but the probe
   templates did not reference `static/main.css`, so the rewrite was not observed. Treat as
   unverified.
4. **Unknown/undocumented config keys' exact rejection behavior** — `config-unknown-key` is a
   *warning* (not an error) unless `--strict`, per docs. Not directly reproduced.
5. **The full text of the embedded documentation** reachable via the MCP resource
   `seite://docs/*`. The binary ships no on-disk docs; that content is only exposed at
   runtime over MCP (stdio JSON-RPC), which was not driven.
6. **Exact MCP tool/resource JSON schemas** — names are known from `AGENTS.md`
   (`seite_check`, `seite_search`, `seite_get_page`, `seite_build`, …) but the request/response
   shapes were not captured.
7. **`seite perf` output format** — not run (requires network + PageSpeed API key for higher
   rate limits).
8. **`seite deploy` against a real remote** — only `--dry-run` was exercised; no git repo or
   remote existed. Actual push/verification behavior and `--verify` output are unobserved.
9. **`seite agent`, `theme create`, and `mcp` runtime behavior** — all require Claude Code /
   an external harness that is not installed here.
10. **Exact `404.html` / `robots.txt` / `llms.txt` text** — files were confirmed present with
    sizes but their contents were not read in full (beyond the `robots.txt` AI-crawler
    directive summary from the docs).
11. **Whether `dist/**/*.md` twins are served/consumed by GitHub Pages** in a way that
    affects the artifact — they are simply extra files in `dist/`.
12. **Precise semantics of `nested = false` for a collection with subdirectories** — whether
    subdirectory files are ignored or flattened was not tested. `docs`/`trust` are
    `nested = true` by preset; `posts`/`pages` are `nested = false`.

## 9. Sources

Observed locally (authoritative for all `[observed]` claims):
- `D:\sdk\seite\seite.exe` 0.20.1 — `--version`, `--help`, per-subcommand `--help`,
  `init`, `build`, `check`, `new`, `collection add`, `collection list`, `theme list`,
  `deploy --dry-run`, `telemetry status`
- Probe project scaffolded at `C:\Users\hugh\AppData\Local\Temp\seite-probe`
  (all generated file contents quoted above are verbatim from it)

Fetched documentation:
- https://seite.sh/docs/getting-started
- https://seite.sh/docs/configuration
- https://seite.sh/docs/collections
- https://seite.sh/docs/deployment
- https://seite.sh/docs/cli-reference

Other doc pages exist but were not fetched: `/docs/templates`, `/docs/custom-themes`,
`/docs/shortcodes`, `/docs/i18n`, `/docs/trust-center`, `/docs/agent`, `/docs/workspace`,
`/docs/mcp-server`, `/docs/theme-gallery`, `/docs/contact-forms`, `/docs/releases`.
Upstream repo: https://github.com/seite-sh/seite
