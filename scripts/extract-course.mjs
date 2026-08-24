import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const pdf = new URL("../assets/usbar-constitutional-law.pdf", import.meta.url).pathname;
const out = new URL("../assets/course-content.json", import.meta.url).pathname;
const pages = [];

const noise = /^(USBAR 美国律师·MBE 联邦法|Constitutional Law 宪法|宪 ?法|Part 1-\d+)$/i;
const englishRatio = text => {
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return latin / Math.max(1, latin + cjk);
};
const isHeading = text => text.length < 105 && (
  /^(Overview|Before the Class|History of|Supreme Court Case|Example|[A-Z]\.|[IVX]+\.|\d+\.|[a-z]\.)/i.test(text) ||
  /^[A-Z][A-Za-z &:'’/-]{3,70}$/.test(text)
);
const endsThought = text => /[.!?。！？：:]$/.test(text) || isHeading(text);

for (let page = 1; page <= 51; page++) {
  const raw = execFileSync("pdftotext", ["-f", String(page), "-l", String(page), "-raw", pdf, "-"], { encoding: "utf8" });
  const lines = raw.split(/\r?\n/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean).filter(x => !noise.test(x));
  const blocks = [];
  for (const line of lines) {
    if (/^USBAR .* Part 1-\d+/.test(line)) continue;
    const lang = englishRatio(line) >= .52 ? "en" : "zh";
    const kind = isHeading(line) ? "heading" : "paragraph";
    const last = blocks.at(-1);
    if (kind === "paragraph" && last?.kind === "paragraph" && last.lang === lang && !endsThought(last.text)) {
      last.text += (lang === "en" ? " " : "") + line;
    } else {
      blocks.push({ id: `p${page}-b${blocks.length + 1}`, lang, kind, text: line });
    }
  }
  pages.push({ page, label: `PDF ${page} / 51`, blocks });
}

writeFileSync(out, JSON.stringify({ title: "USBAR Constitutional Law", sourcePages: 51, generatedAt: new Date().toISOString(), pages }, null, 2));
console.log(`Wrote ${pages.length} pages to ${out}`);
