import http from 'node:http';
import crypto from 'node:crypto';

const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENROUTER_API_KEY;
const clientToken = process.env.CLIENT_TOKEN;
const model = process.env.MODEL || 'openrouter/free';
const requests = new Map();

function respond(res, status, data) {
  res.writeHead(status, { 
    'Content-Type': 'application/json; charset=utf-8', 
    'Cache-Control': 'no-store', 
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function authorized(req) {
  const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!provided || !clientToken) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(clientToken).digest();
  return crypto.timingSafeEqual(a, b);
}

function rateLimited(ip) {
  const now = Date.now();
  const old = requests.get(ip) || { count: 0, reset: now + 60_000 };
  const item = old.reset < now ? { count: 0, reset: now + 60_000 } : old;
  item.count++;
  requests.set(ip, item);
  return item.count > 20;
}

const server = http.createServer(async (req, res) => {
  // CORS হেডার
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  // Pre-flight রিকোয়েস্ট হ্যান্ডেল
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/') return respond(res, 200, { ok: true, name: 'SK AI API', endpoints: ['GET /health', 'POST /api/chat'] });
  if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/api/chat') return respond(res, 404, { error: 'Not found' });
  if (!authorized(req)) return respond(res, 401, { error: 'Unauthorized' });
  if (!apiKey) return respond(res, 503, { error: 'Server not configured' });

  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return respond(res, 429, { error: 'Too many requests' });

  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > 20_000) return respond(res, 413, { error: 'Request too large' });
    }

    const parsed = JSON.parse(body);
    const messages = parsed.messages ?? (typeof parsed.prompt === 'string' ? [{ role: 'user', content: parsed.prompt }] : null);

    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20 || !messages.every(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 8000)) {
      return respond(res, 400, { error: 'Provide prompt or valid messages' });
    }

    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: 1024 }),
      signal: AbortSignal.timeout(45_000)
    });

    const response = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return respond(res, upstream.status === 429 ? 429 : 502, { error: 'AI provider request failed', providerStatus: upstream.status });

    return respond(res, 200, { 
      success: true, 
      model: response.model || model, 
      reply: response.choices?.[0]?.message?.content ?? '', 
      usage: response.usage || null 
    });
  } catch (error) {
    if (error instanceof SyntaxError) return respond(res, 400, { error: 'Invalid JSON' });
    return respond(res, 502, { error: 'Request failed or timed out' });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`SK AI API listening on ${port}`));
