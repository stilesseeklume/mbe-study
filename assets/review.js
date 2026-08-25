/* 三源复习队列 UI：语境还原(挖空) + 一词一造(AI判)，SM-2 调度 */
import {schedule,mastered,dueToday,pickDaily,upsert} from './review-engine.js?v=20260825';
export function initReview(App){
  const {store,save,toast,$}=App;const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  App.enqueueReview=(entry)=>{
    const cur=store.reviewQueue.find(x=>x.id===entry.id);
    if(mastered(cur||{}))return;
    if(cur&&cur.source==='saved'&&entry.source==='lookup')entry={...entry,source:'saved'};
    const merged=cur?{...cur,...entry}:{interval:0,streak:0,status:'reviewing',dueAt:0,...entry};
    upsert(store.reviewQueue,merged);save();renderBadge()};
  function renderBadge(){const n=dueToday(store.reviewQueue).length,b=$('#reviewEntry');if(!b)return;b.querySelector('.n').textContent=n||'';b.classList.toggle('has',n>0)}
  function norm(a){return String(a||'').toLowerCase().replace(/[^a-z'-]/g,'').replace(/(es|ed|ing|s)$/,'')}
  let queue=[],idx=0,right=0;
  function renderCard(){
    const item=queue[idx],host=$('#reviewHost');if(!host)return;
    if(!item){const pct=Math.round(right/Math.max(1,queue.length)*100);
      host.innerHTML=`<section id="retellCard"><h3>Review Done</h3><div class="sub">${right}/${queue.length} 正确（${pct}%）· 明天见</div></section>`;
      window.CloudSync?.logEvent?.('review',`${right}/${queue.length}`);renderBadge();return}
    const cloze=(item.contextSentence||'').replace(new RegExp(item.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),'＿＿＿');
    const mode=idx%2?'write':'cloze';
    host.innerHTML=`<section id="retellCard"><h3>Review · ${idx+1}/${queue.length}</h3>
      <div class="sub">${mode==='cloze'?'语境还原：把词填回去':'一词一造：用这个词写一句（AI 判）'}</div>
      <div class="retell-task"><div class="concept">${esc(item.word)}</div>
      <div class="prompt">${mode==='cloze'?esc(cloze):'Write one sentence using this word.'}</div>
      ${mode==='cloze'?`<input id="rvIn" style="width:100%;padding:8px 11px;border:1px solid #cfd8ea;border-radius:10px;font:inherit;box-sizing:border-box">`:`<textarea id="rvIn" style="width:100%;min-height:60px;border:1px solid #cfd8ea;border-radius:10px;padding:9px 11px;font:inherit;box-sizing:border-box"></textarea>`}
      <div class="actions"><button id="rvGo">Check</button><button id="rvSkip" style="background:#6e7890">跳过(记错)</button></div>
      <div id="rvFb"></div></div></section>`;
    $('#rvGo').onclick=async()=>await judge(item,mode);
    $('#rvSkip').onclick=async()=>{await finish(item,false)};
  }
  async function judge(item,mode){
    const val=$('#rvIn').value.trim();if(!val){toast('先作答');return}
    if(mode==='cloze'){await finish(item,norm(val)===norm(item.word));return}
    $('#rvGo').disabled=true;$('#rvGo').textContent='…';
    try{const f=await App.grade({kind:'sentence',word:item.word,answer:val});await finish(item,Boolean(f.correct),f)}
    catch(e){$('#rvGo').disabled=false;$('#rvGo').textContent='Check';toast('AI 暂不可用，稍后重试')}
  }
  async function finish(item,correct,f){
    if(correct)right+=1;
    const updated=schedule(store.reviewQueue.find(x=>x.id===item.id)||item,correct);
    if(mastered(updated)){updated.status='mastered';toast(`🎓 ${item.word} 毕业！`)}
    upsert(store.reviewQueue,updated);save();
    $('#rvFb').innerHTML=f?`<div class="retell-fb">${f.correct?'✓ '+esc(f.suggestion||''):'✗ '+esc(f.issue||'')+'<br><i>'+esc(f.suggestion||'')+'</i>'}</div>`:`<div class="retell-fb">${correct?'✓ 正确':'✗ 再想想'}</div>`;
    setTimeout(()=>{idx+=1;renderCard()},900);
  }
  function start(){const items=pickDaily(store.reviewQueue);if(!items.length){toast('今天没有到期的复习');return}queue=items;idx=0;right=0;renderCard();window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})}
  const entry=document.createElement('button');entry.id='reviewEntry';entry.className='pill';entry.style.cssText='margin:8px 6px;width:calc(100% - 12px)';entry.innerHTML='↻ 复习 <span class="n" style="background:#f3b7a9;color:#5a2018;border-radius:8px;padding:1px 7px;margin-left:4px"></span>';entry.onclick=start;
  const foot=document.querySelector('.rail-foot');foot?.parentNode?.insertBefore(entry,foot);
  renderBadge();
}
