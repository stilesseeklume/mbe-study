/* 净读计时(每节) + 音频循环三遍法(每页核心节)：读→听→计时重读 */
import {wordsPerMinute,countWords} from './speed-utils.js?v=20260825';
export function initReading(App){
  const {store,save,toast,$,$$}=App;
  const cfg=()=>store.profile?.config||{audioLoop:true,timedReading:'optional'};
  /* A) 每节净读：study-block tools 加 ⏱ 按钮；读完挖空验证防扫读 */
  function timedReread(sec){
    const page=App.course.pages.find(p=>p.page===store.page),block=page?.blocks.find(b=>b.id===sec.dataset.block);
    const text=block?(store.edits[block.id]||block.text):sec.innerText,words=countWords(text),t0=Date.now();
    const layer=document.createElement('div');
    layer.style.cssText='position:fixed;inset:0;z-index:100;background:#fff;overflow:auto;padding:8vh 20px';
    layer.innerHTML=`<div style="max-width:720px;margin:0 auto"><div style="position:sticky;top:0;background:#ffffffeb;backdrop-filter:blur(10px);padding:10px 0;display:flex;gap:10px;align-items:center"><b>净读计时</b><span style="color:#6e7890;font-size:12px">${words} words · 读到本节末尾立刻按按钮</span><button id="trDone" style="margin-left:auto;border:0;background:#16785c;color:#fff;border-radius:10px;padding:9px 18px;font-weight:800;cursor:pointer">读完了</button><button id="trQuit" style="border:1px solid #dfe5f0;background:#fff;border-radius:10px;padding:9px 14px;cursor:pointer">退出</button></div><div style="font-family:Georgia,serif;font-size:15.5px;line-height:1.9;color:#18233a;white-space:pre-line">${text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div></div>`;
    document.body.appendChild(layer);
    const quit=()=>layer.remove();
    layer.querySelector('#trQuit').onclick=quit; // 退出不计
    layer.querySelector('#trDone').onclick=()=>{
      const seconds=(Date.now()-t0)/1000,wpm=wordsPerMinute(words,seconds);
      const record=verified=>{store.readingLog.push({page:store.page,section:sec.dataset.block,words,seconds,wpm,pass:3,verified,date:Date.now()});save();
        window.CloudSync?.logEvent?.('reading',`p${store.page} ${wpm}wpm`);quit();toast(`本节 ${wpm} wpm${wpm>=120?' · 已达 MBE 节奏':''}`)};
      // 防扫读：取本节最长的一个词挖空，填回才算有效
      const terms=text.match(/[A-Za-z][A-Za-z'’-]{5,}/g)||[],key=terms.sort((a,b)=>b.length-a.length)[0]||'';
      const norm=a=>String(a||'').toLowerCase().replace(/(es|ed|ing|s)$/,'');
      if(!key||wpm>400){record(false);return} // 无可挖词或明显扫读，照常记录但标记未验证
      layer.innerHTML=`<div style="max-width:520px;margin:12vh auto;background:#fbfcff;border:1px solid #dfe5f0;border-radius:16px;padding:26px 28px"><b>检查一下：本节出现过这个词，拼出来</b><p style="font-family:Georgia,serif;font-size:18px;letter-spacing:.06em;margin:14px 0">${key.replace(/[A-Za-z]/g,'·')}（${key.length} 字母）</p><input id="trKey" style="width:100%;padding:10px 12px;border:1px solid #cfd8ea;border-radius:10px;font:inherit"><div style="margin-top:12px;display:flex;gap:8px"><button id="trOk" style="border:0;background:#101b35;color:#fff;border-radius:10px;padding:9px 18px;font-weight:800;cursor:pointer">提交</button><button id="trSkip" style="border:1px solid #dfe5f0;background:#fff;border-radius:10px;padding:9px 14px;cursor:pointer">想不起来（照常记录）</button></div></div>`;
      layer.querySelector('#trOk').onclick=()=>{if(norm(layer.querySelector('#trKey').value)===norm(key))record(true);else{toast('拼写不符——这次先不计，重读一遍再来');quit()}};
      layer.querySelector('#trSkip').onclick=()=>record(false)}
  }
  // 挂按钮：renderDocument 后给每个 en 段落 study-block 的 .block-tools 追加 ⏱
  App.decorateBlocks=()=>{$$('.study-block.en:not(.heading)').forEach(sec=>{const tools=sec.querySelector('.block-tools');if(!tools||tools.querySelector('.trBtn'))return;const b=document.createElement('button');b.className='mini trBtn';b.title='净读计时';b.textContent='⏱';b.onclick=()=>timedReread(sec);tools.appendChild(b)})};
  /* B) 三遍法入口条（cfg().audioLoop 才显示） */
  function loopBar(){
    let bar=$('#loopBar');
    if(!cfg().audioLoop){bar?.remove();return}
    if(bar)return;bar=document.createElement('div');bar.id='loopBar';
    bar.style.cssText='display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0 0;padding:12px 16px;border:1px dashed #b9c5dd;border-radius:13px;background:#f8faff;font-size:12px;color:#5d6884';
    bar.innerHTML=`<b style="color:#152344">三遍法训练本页</b><span>① 精读（已完成）</span><button id="lp2" style="border:0;background:#101b35;color:#fff;border-radius:9px;padding:7px 14px;cursor:pointer;font-size:11px">② 听+跟高亮</button><span>③ 每段 ⏱ 净读</span>`;
    const meta=$('.lesson-meta');meta?.after(bar);
    bar.querySelector('#lp2').onclick=()=>{App.speak($('#document .study-block.en .block-text')?.innerText||'');toast('跟着逐词高亮走，听完整节')}
  }
  App.refreshReading=()=>{App.decorateBlocks();loopBar()};
  window.addEventListener('usbar:page',App.refreshReading);App.refreshReading();
}
