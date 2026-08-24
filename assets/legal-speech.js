const protectedPatterns = [
  /\bU\.S\.C\./gi,
  /\bU\.S\./gi,
  /\b(?:e\.g\.|i\.e\.|v\.|vs\.|No\.|Art\.|Sec\.|Inc\.|Co\.|Corp\.|Mr\.|Mrs\.|Ms\.|Dr\.|Ct\.|J\.)/gi,
  /\b[A-Z]\.([A-Z]\.)+/g,
  /\b\d+\.\d+\b/g,
];

function protectDots(text) {
  let masked = text;
  for (const pattern of protectedPatterns) {
    masked = masked.replace(pattern, value => value.replaceAll('.', '·'));
  }
  return masked;
}

export function splitLegalSentences(text) {
  const source = String(text || '');
  if (!source.trim()) return [];
  const masked = protectDots(source);
  if (globalThis.Intl?.Segmenter) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    return [...segmenter.segment(masked)]
      .map(part => ({
        text: source.slice(part.index, part.index + part.segment.length),
        start: part.index,
        end: part.index + part.segment.length,
      }))
      .filter(part => part.text.trim());
  }

  const output = [];
  let start = 0;
  for (let i = 0; i < masked.length; i += 1) {
    if (!/[.!?]/.test(masked[i])) continue;
    let end = i + 1;
    while (/[\"'”’\])]/.test(masked[end] || '')) end += 1;
    if (end < masked.length && !/\s/.test(masked[end])) continue;
    const sentence = source.slice(start, end);
    if (sentence.trim()) output.push({ text: sentence, start, end });
    start = end;
  }
  if (source.slice(start).trim()) output.push({ text: source.slice(start), start, end: source.length });
  return output;
}

export function normalizeLegalSpeech(text) {
  return String(text || '')
    .replace(/[\u3400-\u9fff]+/g, ' ')
    .replace(/§§/g, ' sections ')
    .replace(/§/g, ' section ')
    .replace(/\bU\.S\.C\./gi, 'U S C')
    .replace(/\bU\.S\./gi, 'U S')
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\bvs?\./gi, 'versus')
    .replace(/\bNo\./gi, 'number')
    .replace(/\bArt\./gi, 'Article')
    .replace(/\bSec\./gi, 'Section')
    .replace(/\bCt\./gi, 'Court')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speechUnits(text) {
  const sentences = splitLegalSentences(text);
  return sentences.length ? sentences.map(item => normalizeLegalSpeech(item.text)).filter(Boolean) : [normalizeLegalSpeech(text)].filter(Boolean);
}
