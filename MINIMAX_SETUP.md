# MiniMax speech proxy

The public GitHub Pages site must never contain `MINIMAX_API_KEY`.

Run the included proxy on a server or function runtime with Node.js 18+:

```bash
MINIMAX_API_KEY=... ALLOWED_ORIGIN=https://stilesseeklume.github.io node server/minimax-proxy.mjs
```

Then enter its public `/tts` URL in the website's **语音 → MiniMax 安全代理** field.

The proxy restricts models to `speech-2.8-turbo` and `speech-2.8-hd`, limits input length, pins the official Beijing MiniMax endpoint, and only permits the configured browser origin.
