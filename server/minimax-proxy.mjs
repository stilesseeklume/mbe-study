import http from 'node:http';

const apiKey = process.env.MINIMAX_API_KEY;
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://stilesseeklume.github.io';
const port = Number(process.env.PORT || 9000);
const models = new Set(['speech-2.8-turbo', 'speech-2.8-hd']);

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Vary': 'Origin',
  });
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && requestOrigin !== allowedOrigin) {
    return json(res, 403, { error: 'Origin is not allowed' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, provider: 'MiniMax', apiKeyConfigured: Boolean(apiKey) });
  }
  if (req.method !== 'POST' || req.url !== '/tts') return json(res, 404, { error: 'Not found' });
  if (!apiKey) return json(res, 503, { error: 'MINIMAX_API_KEY is not configured' });

  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 30_000) throw new Error('Request is too large');
    }
    const input = JSON.parse(raw || '{}');
    const text = String(input.text || '').trim();
    if (!text || text.length > 3_000) return json(res, 400, { error: 'Text must contain 1-3000 characters' });
    const model = models.has(input.model) ? input.model : 'speech-2.8-turbo';
    const upstream = await fetch('https://api-bj.minimaxi.com/v1/t2a_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        text,
        stream: false,
        language_boost: 'English',
        voice_setting: {
          voice_id: input.voice_setting?.voice_id || 'English_Graceful_Lady',
          speed: Number(input.voice_setting?.speed || 0.92),
          vol: 1,
          pitch: 0,
          emotion: 'fluent',
        },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
        subtitle_enable: true,
        subtitle_type: 'word',
      }),
    });
    const payload = await upstream.json();
    if (!upstream.ok || payload.base_resp?.status_code) {
      return json(res, 502, { error: payload.base_resp?.status_msg || `MiniMax ${upstream.status}` });
    }
    return json(res, 200, payload);
  } catch (error) {
    return json(res, 500, { error: error.message || String(error) });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`MiniMax proxy listening on http://0.0.0.0:${port}/tts`);
});
