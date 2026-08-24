# MiniMax speech proxy

The public GitHub Pages site must never contain `MINIMAX_API_KEY`.

Run the included proxy on a server or function runtime with Node.js 18+:

```bash
MINIMAX_API_KEY=... ALLOWED_ORIGIN=https://stilesseeklume.github.io node server/minimax-proxy.mjs
```

Then enter its public `/tts` URL in the website's **语音 → MiniMax 安全代理** field.

## Tencent Cloud SCF Web Function

The `server` directory is upload-ready for a Tencent Cloud Web Function:

1. Create a **Web Function** using the **Node.js 18.15** runtime.
2. Upload the contents of the `server` directory. `scf_bootstrap` must remain at the archive root and keep executable permissions.
3. Add environment variables `MINIMAX_API_KEY` and `ALLOWED_ORIGIN=https://stilesseeklume.github.io`.
4. Create a public Function URL, then verify `<function-url>/health`.
5. Paste `<function-url>/tts` into the study site's MiniMax proxy setting.

The proxy restricts models to `speech-2.8-turbo` and `speech-2.8-hd`, limits input length, pins the official Beijing MiniMax endpoint, and only permits the configured browser origin.
