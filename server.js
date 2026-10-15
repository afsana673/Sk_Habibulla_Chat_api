import http from 'node:http';

const port = Number(process.env.PORT || 3000);

// এখানে আপনার OpenRouter API Key টি পেস্ট করে দিন (যদি Render Environment এ না দেওয়া থাকে)
const FALLBACK_API_KEY = "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";

const apiKey = process.env.OPENROUTER_API_KEY || FALLBACK_API_KEY;
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

function rateLimited(ip) {
  const now = Date.now();
  const old = requests.get(ip) || { count: 0, reset: now + 60_000 };
  const item = old.reset < now ? { count: 0, reset: now + 60_000 } : old;
  item.count++;
  requests.set(ip, item);
  return item.count > 60; // প্রতি মিনিটে ৬০টি রিকোয়েস্টের লিমিট
}

const server = http.createServer(async (req, res) => {
  // CORS হেডার
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  // Pre-flight OPTIONS রিকোয়েস্ট হ্যান্ডেল
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // বেসিক রুট ও হেলথ চেক
  if (req.method === 'GET' && req.url === '/') {
    return respond(res, 200, { ok: true, name: 'SK AI API', endpoints: ['GET /health', 'POST /api/chat'] });
  }
  if (req.method === 'GET' && req.url === '/health') {
    return respond(res, 200, { ok: true });
  }

  // এন্ডপয়েন্ট ভ্যালিডেশন
  if (req.method !== 'POST' || req.url !== '/api/chat') {
    return respond(res, 404, { error: 'Not found' });
  }

  // API Key যাচাই
  if (!apiKey || apiKey === "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") {
    return respond(res, 503, { error: 'OpenRouter API Key বসানো হয়নি। দয়া করে server.js ফাইলে বা Render Environment-এ API Key যোগ করুন।' });
  }

  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return respond(res, 429, { error: 'Too many requests' });
  }

  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk.toString();
      if (body.length > 20_000) return respond(res, 413, { error: 'Request too large' });
    }

    const parsed = JSON.parse(body);
    const messages = parsed.messages ?? (typeof parsed.prompt === 'string' ? [{ role: 'user', content: parsed.prompt }] : null);

    if (!Array.isArray(messages) || messages.length < 1) {
      return respond(res, 400, { error: 'Provide prompt or valid messages' });
    }

    // OpenRouter-এ রিকোয়েস্ট পাঠানো
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${apiKey}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ model, messages, max_tokens: 1024 }),
      signal: AbortSignal.timeout(45_000)
    });

    const response = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return respond(res, upstream.status === 429 ? 429 : 502, { 
        error: response.error?.message || 'AI provider request failed', 
        providerStatus: upstream.status 
      });
    }

    return respond(res, 200, { 
      success: true, 
      model: response.model || model, 
      reply: response.choices?.[0]?.message?.content ?? '', 
      usage: response.usage || null 
    });

  } catch (error) {
    if (error instanceof SyntaxError) {
      return respond(res, 400, { error: 'Invalid JSON' });
    }
    return respond(res, 502, { error: 'Request failed or timed out' });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`SK AI API listening on ${port}`));
