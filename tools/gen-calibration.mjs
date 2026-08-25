/* 一次性脚本：生成 assets/calibration.json（article+3理解题+20法律义项题）
   用法: node tools/gen-calibration.mjs  （需 MINIMAX_API_KEY；当前版本为人工撰写备份） */
import {chatJSON} from './llm.mjs';
import fs from 'node:fs';
const course=JSON.parse(fs.readFileSync('assets/course-content.json','utf8'));
const overlay=Object.values(JSON.parse(fs.readFileSync('assets/legal-overlay.json','utf8'))).flat();
const dictionary=JSON.parse(fs.readFileSync('assets/course-dictionary.json','utf8'));
const p10=course.pages.find(p=>p.page===10);
const ids=['p10-b4','p10-b16','p10-b20','p10-b22','p10-b25','p10-b32','p10-b36'];
const text=ids.map(id=>p10.blocks.find(b=>b.id===id).text).join('\n\n');
const words=(text.match(/[A-Za-z][A-Za-z'’-]*/g)||[]).length;
const comp=await chatJSON([{role:'system',content:'You write multiple-choice checks for a Chinese LLM bar candidate. Strict JSON.'},
{role:'user',content:`Write exactly 3 four-option comprehension questions (EN) about this article's legal rules. Return {"comprehension":[{"q":"...","options":["...","...","...","..."],"answer":idx}]}. Article:\n${text}`}]);
const pick=['standing','mootness','ripeness','bars','stake','suits','allege','remedy','injunction','sustained','clause','strike','expenditures','sue','ripe','hardship','discharge','waiver','undue','entertain'];
const vocab=[];
for(const w of pick){
  const o=overlay.find(t=>t.word===w);if(!o)continue;
  const d=dictionary.entries[w]||dictionary.entries[w.replace(/s$/,'')]||{};
  const general=String(d.translation||'').split(/[;；,，\n]/).map(s=>s.trim()).filter(Boolean);
  const r=await chatJSON([{role:'system',content:'Strict JSON.'},
  {role:'user',content:`Make a 4-option multiple-choice item testing the LEGAL meaning of "${w}" for a Chinese student. Correct option = its legal meaning (use: ${o.legalTranslation}). 3 distractors = everyday/general meanings (candidate general senses: ${general.slice(0,4).join('; ')||'plausible everyday senses'}). Shuffle positions. Return {"word":"${w}","options":["...","...","...","..."],"answer":idx}.`}]);
  vocab.push(r);
}
fs.writeFileSync('assets/calibration.json',JSON.stringify({article:{text,words},comprehension:comp.comprehension,vocab},null,1));
console.log(`article ${words}w · ${comp.comprehension.length} comprehension · ${vocab.length} vocab`);
