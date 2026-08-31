const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TelemetryStore, validatePacket } = require('./telemetry');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 8080);
const apiKey = process.env.METRO_API_KEY || '';
const allowedOrigin = process.env.CORS_ORIGIN || '*';
const store = new TelemetryStore(process.env.DATA_DIR || path.join(root, '.data'));
const contentTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.md':'text/markdown; charset=utf-8' };

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':allowedOrigin, ...headers });
  res.end(data);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 2_000_000) { const error = new Error('Request body is too large'); error.status = 413; throw error; }
  }
  try { return JSON.parse(body); } catch { const error = new Error('Malformed JSON'); error.status = 400; throw error; }
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') return send(res, 204, '', { 'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type, X-API-Key', 'Access-Control-Max-Age':'86400' });
  if (req.method === 'GET' && url.pathname === '/api/v1/health') return send(res, 200, { status:'ok', serverTime:new Date().toISOString() });
  if (req.method === 'GET' && url.pathname === '/api/v1/telemetry/latest') return send(res, 200, { generatedAt:new Date().toISOString(), staleAfterSeconds:720, measurements:store.getLatest() });
  if (req.method === 'GET' && url.pathname === '/api/v1/telemetry/history') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 1000), 1), 5000);
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    if ((from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) return send(res, 400, { error:'invalid_query', message:'from and to must be ISO 8601 dates' });
    const measurements = await store.getHistory(url.searchParams.get('deviceId'), from, to, limit);
    return send(res, 200, { measurements, count:measurements.length });
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/link-loss') {
    if (!apiKey) return send(res, 503, { error:'not_configured', message:'METRO_API_KEY is not configured' });
    if (req.headers['x-api-key'] !== apiKey) return send(res, 401, { error:'unauthorized', message:'Invalid API key' });
    const packet = await readJson(req);
    const errors = validatePacket(packet);
    if (errors.length) return send(res, 422, { error:'validation_error', details:errors });
    const result = await store.ingest(packet);
    return send(res, 202, { status:'accepted', ...result, receivedAt:new Date().toISOString() });
  }
  if (req.method === 'GET') {
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.resolve(root, `.${requested}`);
    if (!file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type':contentTypes[path.extname(file)] || 'application/octet-stream' });
      return res.end(body);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return send(res, 404, { error:'not_found' });
}

store.init().then(() => http.createServer((req, res) => handler(req, res).catch(error => send(res, error.status || 500, { error:error.status ? 'bad_request' : 'internal_error', message:error.message }))).listen(port, () => {
  console.log(`Metro dashboard listening on http://localhost:${port}`);
})).catch(error => { console.error(error); process.exit(1); });
