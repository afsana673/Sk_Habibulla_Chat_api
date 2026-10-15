# SK AI API (OpenRouter -> Render)

## Deploy
1. Upload `server.js`, `package.json`, `render.yaml`, and `.gitignore` to a GitHub repository.
2. In Render choose **New > Blueprint**, connect repository and deploy (or create a Web Service using `npm start`).
3. Set environment variable `OPENROUTER_API_KEY` to a **new** OpenRouter key, not the key shared in chat. Blueprint generates `CLIENT_TOKEN`; if creating a service manually set a long random `CLIENT_TOKEN` yourself.
4. Optionally set `MODEL` (default `openrouter/free`).
5. Use `GET https://YOUR-SERVICE.onrender.com/health` for status.

## Chat example
```bash
curl -X POST https://YOUR-SERVICE.onrender.com/api/chat \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_CLIENT_TOKEN' \
  -d '{"prompt":"Hello!"}'
```

POST also accepts `{ "messages": [{ "role": "user", "content": "Hello" }] }`.

**Security:** Never commit OpenRouter key or client token. Keep CLIENT_TOKEN in trusted server-side applications; do not expose it in public HTML/JS. Rotate any key pasted into chats.
