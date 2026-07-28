// Verifies every internal link in dist/ resolves — both the target file and, for
// fragment links, the target heading id. Run after `npm run build`.
//
// Broken cross-references are the most common way docs rot, and they are invisible
// until a reader hits one, so this is worth the 40 lines.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')

const files = fs.readdirSync(DIST).filter((f) => f.endsWith('.html'))
const ids = new Map()

for (const file of files) {
  const html = fs.readFileSync(path.join(DIST, file), 'utf8')
  ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])))
}

const problems = []

for (const file of files) {
  const html = fs.readFileSync(path.join(DIST, file), 'utf8')
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1]
    if (/^(https?:|mailto:|#)/.test(href)) {
      // Same-page fragment
      if (href.startsWith('#') && href !== '#' && !ids.get(file).has(href.slice(1))) {
        problems.push(`${file}: missing anchor ${href}`)
      }
      continue
    }
    const [target, fragment] = href.split('#')
    if (!ids.has(target)) {
      // Not an HTML page — a stylesheet, script or image. Only its existence matters.
      if (!fs.existsSync(path.join(DIST, target))) {
        problems.push(`${file}: link to missing file ${target}`)
      }
      continue
    }
    if (fragment && !ids.get(target).has(fragment)) {
      problems.push(`${file}: ${target} has no anchor #${fragment}`)
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} broken link(s):`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`all internal links resolve across ${files.length} pages`)
