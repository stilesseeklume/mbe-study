import {chatJSON} from './llm.mjs';
import fs from 'node:fs';
const [from,to]=process.argv.slice(2).map(Number);
const course=JSON.parse(fs.readFileSync('assets/course-content.json','utf8'));
const pages=course.pages.filter(p=>p.page>=from&&p.page<=to);
const out=JSON.parse(fs.readFileSync('assets/legal-overlay.json','utf8').catch(()=>'{}'));
for(const page of pages){
  const en=page.blocks.filter(b=>b.lang==='en').map(b=>b.text).join('\n').slice(0,6000);
  const prompt=[{role:'system',content:'You are a legal-English lexicographer for Chinese LLM bar candidates. Output strict JSON.'},
  {role:'user',content:`From this bar-review page, pick the 8-12 English terms where the LEGAL sense differs from or refines the general sense (e.g. establishment, sustain, consideration). Return JSON: {"terms":[{"word":"lowercase-key","display":"Original Form","phonetic":"","legalTranslation":"中文法律义","legalNote":"one-line EN note","generalTrap":"通用义为什么误导，中文"}]}. Page ${page.page} text:\n${en}`}];
  const r=await chatJSON(prompt);
  out[page.page]=r.terms;fs.writeFileSync('assets/legal-overlay.json',JSON.stringify(out,null,1));
  console.log(`page ${page.page}: ${r.terms.length} terms`);
}
