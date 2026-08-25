import {chatJSON} from './llm.mjs';
import fs from 'node:fs';
const [from,to]=process.argv.slice(2).map(Number);
const course=JSON.parse(fs.readFileSync('assets/course-content.json','utf8'));
const out=JSON.parse(fs.readFileSync('assets/retell-tasks.json','utf8').catch(()=>'{}'));
for(const page of course.pages.filter(p=>p.page>=from&&p.page<=to)){
  const en=page.blocks.filter(b=>b.lang==='en').map(b=>b.text).join('\n').slice(0,6000);
  const r=await chatJSON([{role:'system',content:'You design output-practice tasks for a Chinese LLM bar candidate. Strict JSON.'},
  {role:'user',content:`From this bar-review page, create exactly 3 retell tasks on the page's core rules/doctrines. Each: concept (short EN name), prompt (one English sentence telling what to restate — do NOT quote the rule), reference (comma-separated key points a correct answer must hit, EN). Return {"tasks":[{"concept":"...","prompt":"...","reference":"..."}]}. Page text:\n${en}`}]);
  out[page.page]=r.tasks.slice(0,3);fs.writeFileSync('assets/retell-tasks.json',JSON.stringify(out,null,1));
  console.log(`page ${page.page}: ${out[page.page].length} tasks`);
}
