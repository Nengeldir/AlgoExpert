// Minimal static server for previewing dist/ locally: `npm run serve`.
// Production serving is Caddy (see Dockerfile.docs.railway) — this exists so you can
// check a build without Docker.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = Number(process.env.PORT ?? 4180)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '')
    if (!path.extname(rel)) rel += '.html'

    // Contain path traversal: resolve, then verify the result is still inside dist/.
    const file = path.resolve(DIST, rel)
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        fs.readFile(path.join(DIST, '404.html'), (e, notFound) => {
          res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(e ? 'Not found' : notFound)
        })
        return
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
      res.end(data)
    })
  })
  .listen(PORT, () => console.log(`docs preview: http://localhost:${PORT}`))
