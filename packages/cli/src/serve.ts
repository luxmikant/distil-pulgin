/**
 * A self-contained web dashboard over `PROJECT.ctx`.
 *
 * `distil serve` starts a tiny `node:http` server with zero runtime
 * dependencies. The single HTML page fetches `/ctx.json` (re-read from disk on
 * every request, so `sync`/`digest` updates appear on reload) and renders the
 * digest, token budget, sessions, tools, and files with inline SVG-free CSS.
 * Offline by design: no CDN, no build step, no third-party assets.
 *
 * @module @distil/cli/serve
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DistilContextV1 } from '../../engine/src/index.ts'
import { readContext, renderMarkdown } from '../../engine/src/index.ts'

export interface ServeOptions {
  /** Absolute path to the `.ctx` file to serve. */
  ctxPath: string
  port?: number
  host?: string
  log?: (message: string) => void
}

/** Start the dashboard and resolve once the server is listening. */
export async function serve(opts: ServeOptions): Promise<void> {
  const port = opts.port ?? 4173
  const host = opts.host ?? '127.0.0.1'
  const log = opts.log ?? (() => {})
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    if (url === '/ctx.json') return json(response, () => readContext(opts.ctxPath))
    if (url === '/markdown') return text(response, 'text/markdown; charset=utf-8', () => readContext(opts.ctxPath).then(renderMarkdown))
    if (url === '/' || url === '/index.html') return text(response, 'text/html; charset=utf-8', () => DASHBOARD_HTML)
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })
  const address = server.address() as AddressInfo
  log(`distil dashboard → http://${host}:${address.port}`)
}

function json(response: import('node:http').ServerResponse, produce: () => unknown | Promise<unknown>): void {
  void Promise.resolve(produce()).then(
    value => {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(value))
    },
    error => fail(response, error),
  )
}

function text(response: import('node:http').ServerResponse, contentType: string, produce: () => string | Promise<string>): void {
  void Promise.resolve(produce()).then(
    value => {
      response.writeHead(200, { 'content-type': contentType })
      response.end(value)
    },
    error => fail(response, error),
  )
}

function fail(response: import('node:http').ServerResponse, error: unknown): void {
  response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ error: (error as Error).message }))
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Distil — project context</title>
<style>
:root{--bg:#0e1117;--panel:#161b22;--text:#e6edf3;--muted:#8b949e;--accent:#3fb950;--border:#30363d;--blue:#79c0ff}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}
header{padding:22px 32px;border-bottom:1px solid var(--border);display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
header h1{margin:0;font-size:21px;font-weight:600}
header .meta{color:var(--muted);font-size:13px}
main{padding:24px 32px;max-width:1040px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 18px}
.card h2{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
.metric{font-size:26px;font-weight:600}
.metric small{font-size:12px;color:var(--muted);font-weight:400}
.bar{height:8px;border-radius:4px;background:var(--border);margin-top:10px;overflow:hidden}
.bar span{display:block;height:100%;background:var(--accent)}
.section{margin-bottom:18px}
.section h3{margin:0 0 6px;font-size:15px;font-weight:600}
ul{margin:0;padding-left:18px}
li{margin:4px 0;line-height:1.5}
.muted{color:var(--muted)}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;background:rgba(31,111,235,.16);color:var(--blue);font-size:12px;margin-left:6px}
.card.block{margin-top:16px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
</style>
</head>
<body>
<header>
  <h1 id="name">…</h1>
  <span class="meta" id="meta"></span>
</header>
<main>
  <div class="grid" id="budget"></div>
  <div class="card block"><h2>Digest</h2><div id="digest"></div></div>
  <div class="card block"><h2>Sessions</h2><div id="sessions"></div></div>
  <div class="card block"><h2>Tools</h2><div id="tools"></div></div>
  <div class="card block"><h2>Files touched</h2><div id="files"></div></div>
</main>
<script>
(function () {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var secNames = ['primaryRequestAndIntent','keyTechnicalConcepts','filesAndCode','errorsAndFixes','pendingJobs','currentWork','nextStep','criticalContext'];
  var secTitle = {
    primaryRequestAndIntent: 'Primary Request and Intent',
    keyTechnicalConcepts: 'Key Technical Concepts',
    filesAndCode: 'Files and Code',
    errorsAndFixes: 'Errors and Fixes',
    pendingJobs: 'Pending Jobs',
    currentWork: 'Current Work',
    nextStep: 'Next Step',
    criticalContext: 'Critical Context'
  };
  function bar(label, value) {
    return '<div class="card"><h2>' + label + '</h2><div class="metric">' + Number(value).toLocaleString() + '</div>' +
      '<div class="bar"><span style="width:' + Math.round(value / maxTokens * 100) + '%"></span></div></div>';
  }
  var maxTokens = 1;
  function render(ctx) {
    document.getElementById('name').textContent = ctx.project.name + ' — project context';
    document.getElementById('meta').textContent = 'updated ' + ctx.project.updatedAt + ' · ' + Object.keys(ctx.sessions).length + ' session(s) folded · evidence ' + ctx.digest.fromSessions.length + ' session(s)';
    var u = ctx.budget.usage;
    var total = u.totalTokens != null ? u.totalTokens : (u.inputTokens + u.outputTokens);
    maxTokens = Math.max(u.inputTokens, u.outputTokens, u.cacheReadTokens || 0, total, 1);
    document.getElementById('budget').innerHTML =
      bar('Input tokens', u.inputTokens) +
      bar('Output tokens', u.outputTokens) +
      bar('Cache read', u.cacheReadTokens || 0) +
      bar('Total', total) +
      (ctx.budget.usageEstimated ? '<div class="card"><h2>Note</h2><div class="muted">Some turns had no provider-reported usage.</div></div>' : '');
    var digest = ctx.digest.sections || {};
    document.getElementById('digest').innerHTML = secNames.map(function (n) {
      var items = (digest[n] || []).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('');
      return '<div class="section"><h3>' + secTitle[n] + '</h3><ul>' + (items || '<li class="muted">(none)</li>') + '</ul></div>';
    }).join('');
    var sessions = Object.values(ctx.sessions || {});
    document.getElementById('sessions').innerHTML = sessions.map(function (s) {
      return '<div class="section"><h3>' + esc(s.sessionId) + '<span class="pill">' + s.turns + ' turn(s)</span></h3>' +
        '<div class="muted">' + esc(s.startedAt || '') + ' → ' + esc(s.endedAt || '') + '</div>' +
        '<div class="muted">in ' + Number(s.usage.inputTokens).toLocaleString() + ' · out ' + Number(s.usage.outputTokens).toLocaleString() + ' tokens' + (s.usageEstimated ? ' (partial)' : '') + '</div></div>';
    }).join('') || '<p class="muted">No sessions folded yet — run distil sync.</p>';
    var tools = Object.entries(ctx.tools || {});
    document.getElementById('tools').innerHTML = tools.length
      ? tools.map(function (e) { return '<li>' + esc(e[0]) + ' — ' + e[1].calls + ' call(s)' + (e[1].approvals ? ', ' + e[1].approvals + ' approval-gated' : '') + '</li>'; }).join('')
      : '<p class="muted">(none)</p>';
    var files = Object.entries(ctx.files || {});
    document.getElementById('files').innerHTML = files.length
      ? files.map(function (e) { return '<li><code>' + esc(e[0]) + '</code> <span class="muted">first seen ' + esc(e[1].firstSeenAt) + '</span></li>'; }).join('')
      : '<p class="muted">(none)</p>';
  }
  function load() {
    fetch('/ctx.json').then(function (r) { return r.json(); }).then(render).catch(function () {});
  }
  load();
  setInterval(load, 5000);
})();
</script>
</body>
</html>
`
