import http from 'node:http';
const port = Number(process.env.PORT || 9001);
const origin = process.env.ALLOWED_ORIGIN || 'http://localhost:8931';
const server = http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': origin, 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin' };
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }); return res.end(); }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw || '{}');
  if (input.action === 'grade') {
    res.writeHead(200, cors);
    if (input.kind === 'sentence') {
      return res.end(JSON.stringify({ feedback: { correct: true, issue: '', suggestion: `Good use of "${input.word}".` } }));
    }
    return res.end(JSON.stringify({ feedback: { term_issues: [{ issue: 'missing key term: personal stake', fix: 'a concrete, personal stake in the outcome' }], style_issues: [], rewrite: 'A plaintiff must allege a concrete, personal stake in the outcome, traceable to the defendant and likely to be redressed.', term_accuracy: 72 } }));
  }
  res.writeHead(404, cors);
  res.end(JSON.stringify({ error: 'mock only supports grade' }));
});
server.listen(port, () => console.log(`mock grader on :${port}`));
