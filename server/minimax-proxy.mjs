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
  if ((req.method === 'POST' || req.method === 'OPTIONS') && requestOrigin !== allowedOrigin) {
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
    if (input.action === 'grade') return handleGrade(input, res);
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

async function handleGrade(input, res) {
  if (!apiKey) return json(res, 503, { error: 'MINIMAX_API_KEY is not configured' });
  const kind = input.kind === 'sentence' ? 'sentence' : 'retell';
  const answer = String(input.answer || '').trim();
  if (!answer || answer.length > 4000) return json(res, 400, { error: 'answer must contain 1-4000 characters' });
  const system = kind === 'retell'
    ? 'You grade a Chinese LLM bar candidate\'s English restatement of a US law rule. Respond ONLY with JSON: {"term_issues":[{"issue":"...","fix":"..."}],"style_issues":[{"issue":"...","fix":"..."}],"rewrite":"native 2-3 sentence model answer","term_accuracy":0-100}. Rules: English only; no chatting; flag wrong/missing legal terms (term_issues), unidiomatic or translated-from-Chinese phrasing (style_issues); rewrite must be model legal English; term_accuracy = share of key terms used correctly.'
    : 'You judge one sentence written by a Chinese LLM bar candidate using a target legal word. Respond ONLY with JSON: {"correct":true/false,"issue":"empty if correct","suggestion":"corrected sentence if wrong"}. English only.';
  const user = kind === 'retell'
    ? `Concept: ${input.concept}\nPrompt: ${input.prompt}\nReference points: ${input.reference}\nCandidate answer: ${answer}`
    : `Target word: ${input.word}\nCandidate sentence: ${answer}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const upstream = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.GRADING_MODEL || 'MiniMax-Text-01', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 1200 }),
      });
      const payload = await upstream.json();
      const content = payload.choices?.[0]?.message?.content || '';
      if (!upstream.ok || payload.base_resp?.status_code) return json(res, 502, { error: payload.base_resp?.status_msg || `MiniMax ${upstream.status}` });
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no JSON in model output');
      return json(res, 200, { feedback: JSON.parse(m[0]) });
    } catch (e) { if (attempt === 1) return json(res, 502, { error: `grading failed: ${e.message}` }); }
  }
}

server.listen(port, '0.0.0.0', () => {
  console.log(`MiniMax proxy listening on http://0.0.0.0:${port}/tts`);
});
