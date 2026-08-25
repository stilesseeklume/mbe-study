/* 复述驱动输出：每页3任务，AI批改，完成绑定（试运行页 9-16） */
export function initRetell(App){
  const {store,save,toast,$}=App;
  const style=document.createElement('style');
  style.textContent=`#retellCard{border:1px solid #dfe5f0;border-radius:16px;background:#fbfcff;margin:26px 0 0;overflow:hidden}
  #retellCard h3{margin:0;padding:16px 20px 4px;font-size:15px;color:#152344}
  #retellCard .sub{padding:0 20px 12px;font-size:11px;color:#6e7890}
  .retell-task{border-top:1px solid #edf0f5;padding:14px 20px}
  .retell-task .concept{font-weight:800;color:#101b35;font-size:13px}
  .retell-task .prompt{font-size:11.5px;color:#5d6884;margin:4px 0 8px;line-height:1.6}
  .retell-task textarea{width:100%;min-height:70px;border:1px solid #cfd8ea;border-radius:10px;padding:9px 11px;font:inherit;font-size:12.5px;resize:vertical;box-sizing:border-box}
  .retell-task .actions{display:flex;gap:8px;margin-top:8px;align-items:center}
  .retell-task button{border:0;border-radius:9px;background:#101b35;color:#fff;padding:8px 16px;font-size:11.5px;font-weight:700;cursor:pointer}
  .retell-task button:disabled{background:#9aa5bd;cursor:default}
  .retell-fb{margin-top:10px;border-left:2px solid #63c7a6;background:#f2fbf7;padding:9px 12px;border-radius:0 9px 9px 0;font-size:12px;line-height:1.7;color:#2d4a3f;overflow:hidden}
  .retell-fb b{color:#16785c}
  .retell-fb .rw{display:block;margin-top:6px;font-family:Georgia,serif;color:#1c2c4d}
  .retell-fb .acc{float:right;font-weight:800;color:#16785c}`;
  document.head.appendChild(style);
  const tasksFor=()=>window.RETELL_TASKS?.[store.page]||null;
  function log(){return store.retellLog[store.page]||{}}
  function doneCount(){const tasks=tasksFor();return tasks?Object.keys(log()).filter(k=>log()[k]?.feedback).length:0}
  function render(){
    const host=$('#retellHost'),tasks=tasksFor();if(!host)return;
    if(!tasks){host.innerHTML='';return}
    host.innerHTML=`<section id="retellCard"><h3>Restate the Rules · 复述输出</h3><div class="sub">凭理解用自己的英文重述——不给原文。完成 ${doneCount()}/${tasks.length} 后本页才算完成。</div>${tasks.map((t,i)=>taskHtml(t,i)).join('')}</section>`;
    tasks.forEach((t,i)=>wire(t,i));
  }
  function taskHtml(t,i){const saved=log()[i]||{};
    return `<div class="retell-task"><div class="concept">${i+1}. ${esc(t.concept)}</div><div class="prompt">${esc(t.prompt)}</div>
    <textarea id="rtA${i}" ${saved.feedback?'disabled':''}>${esc(saved.answer||'')}</textarea>
    <div class="actions"><button id="rtB${i}" ${saved.feedback?'disabled':''}>${saved.feedback?'✓ Graded':'Submit'}</button></div>
    ${saved.feedback?feedbackHtml(saved.feedback):''}</div>`}
  function feedbackHtml(f){return `<div class="retell-fb"><span class="acc">${f.term_accuracy ?? '—'}</span>
    ${f.term_issues?.length?`<div><b>Terms</b><br>${f.term_issues.map(x=>esc(x.issue)+' → <i>'+esc(x.fix)+'</i>').join('<br>')}</div>`:''}
    ${f.style_issues?.length?`<div style="margin-top:6px"><b>Style</b><br>${f.style_issues.map(x=>esc(x.issue)+' → <i>'+esc(x.fix)+'</i>').join('<br>')}</div>`:''}
    <span class="rw">✦ ${esc(f.rewrite||'')}</span></div>`}
  function wire(t,i){const b=$('#rtB'+i);if(!b||b.disabled)return;b.onclick=async()=>{
    const answer=$('#rtA'+i).value.trim();if(answer.split(/\s+/).length<10){toast('再写完整一点——至少10词');return}
    b.disabled=true;b.textContent='Grading…';
    try{const feedback=await App.grade({kind:'retell',concept:t.concept,prompt:t.prompt,reference:t.reference,answer});
      store.retellLog[store.page]={...log(),[i]:{answer,feedback,time:Date.now()}};save();
      (feedback.term_issues||[]).forEach(x=>{if(x.fix)App.enqueueReview?.({id:'c:'+x.fix,word:x.fix,type:'chunk',source:'corrected',contextSentence:x.fix})});
      render();if(doneCount()>=tasksFor().length&&!store.completed.includes(store.page)){store.completed.push(store.page);save();App.renderAll();toast('输出闭环完成，本页已标记 ✓')}
    }catch(e){b.disabled=false;b.textContent='Submit';toast('批改暂不可用：已保存草稿，稍后重试');store.retellLog[store.page]={...log(),[i]:{answer}};save()}}
  }
  function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
  App.refreshRetell=render;
  App.completeGate=()=>!tasksFor()||doneCount()>=tasksFor().length;
  window.addEventListener('usbar:page',render);render();
}
