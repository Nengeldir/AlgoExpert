// Static site generator for the operator handbook.
//
// Deliberately small: markdown in, HTML out, no framework. Everything a future TA needs
// to understand lives in this one file. Run `npm run build` (or `npm run dev` to watch).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import hljs from 'highlight.js'

import { site, nav, pages } from './site.config.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const CONTENT = path.join(ROOT, 'content')
const ASSETS = path.join(ROOT, 'assets')
const DIST = path.join(ROOT, 'dist')

const WATCH = process.argv.includes('--watch')

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Stable, URL-safe heading ids. Kept explicit so anchors never shift under us. */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* fall through to escaped plain text */
      }
    }
    return md.utils.escapeHtml(code)
  },
}).use(anchor, {
  slugify,
  level: [2, 3],
  permalink: anchor.permalink.linkInsideHeader({
    symbol: '#',
    placement: 'after',
    class: 'heading-anchor',
    ariaHidden: true,
  }),
})

// `> **Note:** ...` style blockquotes get an accent based on their first bold word,
// so callouts read as callouts without inventing a custom markdown syntax.
const CALLOUT_KINDS = { note: 'note', tip: 'tip', warning: 'warning', danger: 'danger' }

function decorateCallouts(html) {
  return html.replace(/<blockquote>\s*<p><strong>(\w+):<\/strong>/g, (match, word) => {
    const kind = CALLOUT_KINDS[word.toLowerCase()]
    if (!kind) return match
    return `<blockquote class="callout callout--${kind}"><p><strong>${word}:</strong>`
  })
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderPage(source) {
  const env = {}
  const tokens = md.parse(source, env)

  let title = null
  const toc = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'heading_open') continue
    const text = tokens[i + 1]?.content ?? ''
    if (token.tag === 'h1' && title === null) {
      title = text
      continue
    }
    if (token.tag === 'h2' || token.tag === 'h3') {
      const id = token.attrGet('id')
      if (id) toc.push({ id, text, depth: token.tag === 'h2' ? 2 : 3 })
    }
  }

  const html = decorateCallouts(md.renderer.render(tokens, md.options, env))
  return { title, toc, html }
}

function stripTags(html) {
  return html
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function sidebar(activeSlug) {
  return nav
    .map((section) => {
      const links = section.items
        .map((item) => {
          const active = item.slug === activeSlug ? ' class="active" aria-current="page"' : ''
          return `<li><a href="${item.slug}.html"${active}>${item.title}</a></li>`
        })
        .join('\n')
      return `<div class="nav-section">
  <p class="nav-section__title">${section.section}</p>
  <ul>
${links}
  </ul>
</div>`
    })
    .join('\n')
}

function onThisPage(toc) {
  if (toc.length < 2) return ''
  const links = toc
    .map(
      (h) =>
        `<li class="toc-depth-${h.depth}"><a href="#${h.id}">${md.utils.escapeHtml(h.text)}</a></li>`,
    )
    .join('\n')
  return `<nav class="toc" aria-label="On this page">
  <p class="toc__title">On this page</p>
  <ul>
${links}
  </ul>
</nav>`
}

function pagination(index) {
  const prev = pages[index - 1]
  const next = pages[index + 1]
  if (!prev && !next) return ''
  const prevHtml = prev
    ? `<a class="pager__link pager__link--prev" href="${prev.slug}.html"><span class="pager__dir">Previous</span><span class="pager__title">${prev.title}</span></a>`
    : '<span></span>'
  const nextHtml = next
    ? `<a class="pager__link pager__link--next" href="${next.slug}.html"><span class="pager__dir">Next</span><span class="pager__title">${next.title}</span></a>`
    : '<span></span>'
  return `<nav class="pager" aria-label="Pagination">${prevHtml}${nextHtml}</nav>`
}

function layout({ pageTitle, slug, section, body, toc, index }) {
  const fullTitle = slug === 'index' ? site.title : `${pageTitle} — ${site.shortTitle}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeAttr(fullTitle)}</title>
<meta name="description" content="${escapeAttr(site.description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/docs.css">
<script>
  // Applied before first paint so a dark-theme reader never sees a white flash.
  (function () {
    try {
      var stored = localStorage.getItem('docs-theme')
      if (stored === 'dark' || stored === 'light') {
        document.documentElement.setAttribute('data-theme', stored)
      }
    } catch (e) {}
  })()
</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>

<header class="topbar">
  <button class="topbar__menu" id="menu-toggle" aria-label="Toggle navigation" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
  <a class="topbar__brand" href="index.html">
    <span class="topbar__mark" aria-hidden="true"></span>
    <span class="topbar__name">${site.shortTitle}</span>
  </a>
  <div class="topbar__search">
    <input type="search" id="search-input" placeholder="Search the handbook…" autocomplete="off"
           aria-label="Search documentation" aria-controls="search-results">
    <div class="search-results" id="search-results" role="listbox" hidden></div>
  </div>
  <button class="topbar__theme" id="theme-toggle" aria-label="Toggle colour theme" title="Toggle colour theme">
    <span class="topbar__theme-icon"></span>
  </button>
</header>

<div class="shell">
  <aside class="sidebar" id="sidebar">
    <nav aria-label="Documentation sections">
${sidebar(slug)}
    </nav>
  </aside>
  <div class="sidebar-scrim" id="sidebar-scrim" hidden></div>

  <main class="main" id="main">
    <article class="prose">
      <p class="eyebrow">${section}</p>
${body}
    </article>
    ${pagination(index)}
    <footer class="footer">
      <p>ETH Zurich — Expert Algorithm voting app. Generated from <code>docs-site/content/</code>.</p>
    </footer>
  </main>

  ${onThisPage(toc)}
</div>

<script src="assets/docs.js" defer></script>
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function build() {
  const started = Date.now()

  // Fail loudly if content/ and site.config.mjs disagree — a page that exists but is
  // unreachable, or a nav entry pointing at nothing, is a bug worth stopping for.
  const onDisk = fs
    .readdirSync(CONTENT)
    .filter((f) => f.endsWith('.md'))
    .sort()
  const declared = pages.map((p) => p.file).sort()
  const missing = declared.filter((f) => !onDisk.includes(f))
  const orphaned = onDisk.filter((f) => !declared.includes(f))
  if (missing.length) throw new Error(`site.config.mjs lists missing files: ${missing.join(', ')}`)
  if (orphaned.length)
    throw new Error(`content/ has files not listed in site.config.mjs: ${orphaned.join(', ')}`)

  fs.rmSync(DIST, { recursive: true, force: true })
  fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true })

  const searchIndex = []

  pages.forEach((page, index) => {
    const source = fs.readFileSync(path.join(CONTENT, page.file), 'utf8')
    const { title, toc, html } = renderPage(source)

    fs.writeFileSync(
      path.join(DIST, `${page.slug}.html`),
      layout({
        pageTitle: title ?? page.title,
        slug: page.slug,
        section: page.section,
        body: html,
        toc,
        index,
      }),
      'utf8',
    )

    searchIndex.push({
      slug: page.slug,
      title: title ?? page.title,
      section: page.section,
      headings: toc.map((h) => ({ id: h.id, text: h.text })),
      // Capped so the index stays a quick download; enough for a keyword hit.
      text: stripTags(html).slice(0, 4000),
    })
  })

  fs.writeFileSync(path.join(DIST, 'search-index.json'), JSON.stringify(searchIndex), 'utf8')

  for (const file of fs.readdirSync(ASSETS)) {
    fs.copyFileSync(path.join(ASSETS, file), path.join(DIST, 'assets', file))
  }
  fs.copyFileSync(path.join(ASSETS, 'favicon.svg'), path.join(DIST, 'favicon.svg'))

  // Caddy serves this for unmatched paths; keep it a real page, not an SPA fallback.
  fs.writeFileSync(
    path.join(DIST, '404.html'),
    layout({
      pageTitle: 'Page not found',
      slug: '404',
      section: 'Error',
      body: '<h1>Page not found</h1><p>That page does not exist in the handbook. Try the <a href="index.html">overview</a> or the search box above.</p>',
      toc: [],
      index: -1,
    }),
    'utf8',
  )

  console.log(`built ${pages.length} pages -> dist/ in ${Date.now() - started}ms`)
}

build()

if (WATCH) {
  console.log('watching content/ and assets/ …')
  let timer = null
  const rebuild = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        build()
      } catch (err) {
        console.error(err.message)
      }
    }, 80)
  }
  fs.watch(CONTENT, rebuild)
  fs.watch(ASSETS, rebuild)
}
