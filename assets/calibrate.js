/* 第1周一次性校准：测速→复述基线→词汇覆盖 → profile 自适应 */
import {countWords} from './speed-utils.js?v=20260825';
export function initCalibrate(App){
  const {store,save,toast}=App;
  const data=window.CALIBRATION;if(!data)return;
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const entryHost=document.querySelector('.rail-foot')?.parentNode;
  if(store.profile){ // 已校准：4 周后可重测
    const again=document.createElement('button');again.id='calibEntry';again.className='pill';again.style.cssText='margin:6px 6px;width:calc(100% - 12px)';again.textContent='↻ 重新校准';
    again.onclick=()=>{if(Date.now()-store.profile.date>28*864e5||confirm('距上次校准不足 4 周，仍要重测？')){store.profile=null;save();sessionStorage.setItem('calib','{}');location.reload()}};
    entryHost?.insertBefore(again,document.querySelector('.rail-foot'));return}
  const wiz=document.createElement('div');wiz.id='calibWiz';
  wiz.style.cssText='position:fixed;inset:0;z-index:110;background:#f2f5fb;overflow:auto;padding:6vh 18px';
  const state=JSON.parse(sessionStorage.getItem('calib')||'{}');
  const persist=()=>sessionStorage.setItem('calib',JSON.stringify(state));
  const $=s=>wiz.querySelector(s);
  function shell(inner){if(!wiz.isConnected)document.body.appendChild(wiz);wiz.innerHTML=`<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #dfe5f0;border-radius:18px;padding:28px 30px;box-shadow:0 20px 60px rgba(26,42,74,.10)">${inner}</div>`}
  /* 步骤1 测速（读完→计时停→理解题防扫读） */
  function step1(){shell(`<div style="font-size:10px;letter-spacing:.16em;color:#5f82c8;font-weight:800">CALIBRATION 1/3</div>
    <h2 style="margin:8px 0 4px">阅读测速</h2><p style="color:#6e7890;font-size:12px">点开始后通读全文，读完立刻按"读完了"。别跳读——后面有理解题。</p>
    <button id="cbStart" style="border:0;background:#101b35;color:#fff;border-radius:11px;padding:11px 22px;font-weight:800;cursor:pointer;margin:10px 0">开始计时阅读</button>
    <div id="cbArticle" style="display:${state.t0?'block':'none'};font-family:Georgia,serif;font-size:15px;line-height:1.85;color:#18233a;white-space:pre-line">${esc(data.article.text)}</div>
    <button id="cbDone" style="display:${state.t0?'inline-block':'none'};border:0;background:#16785c;color:#fff;border-radius:11px;padding:11px 22px;font-weight:800;cursor:pointer;margin-top:12px">读完了</button>`);
    $('#cbStart').onclick=()=>{state.t0=Date.now();persist();step1()};
    $('#cbDone').onclick=()=>{state.seconds=(Date.now()-state.t0)/1000;state.wpm=Math.round((data.article.words||countWords(data.article.text))/(state.seconds/60));persist();step1b()}}
  function step1b(){const qs=data.comprehension;
    shell(`<h2>理解检查</h2>${qs.map((q,i)=>`<div style="margin:14px 0"><p style="font-size:13px">${i+1}. ${esc(q.q)}</p>${q.options.map((o,j)=>`<label style="display:block;font-size:12.5px;margin:5px 0"><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label>`).join('')}</div>`).join('')}<button id="cbNext" style="border:0;background:#101b35;color:#fff;border-radius:10px;padding:10px 20px;font-weight:800;cursor:pointer">提交</button>`);
    $('#cbNext').onclick=()=>{const right=qs.filter((q,i)=>+wiz.querySelector(`input[name=q${i}]:checked`)?.value===q.answer).length;
      if(right<2){toast('理解题未达 2/3，请重测一遍');state.t0=null;persist();step1();return}
      step2()}}
  /* 步骤2 复述基线 */
  function step2(){shell(`<div style="font-size:10px;letter-spacing:.16em;color:#5f82c8;font-weight:800">CALIBRATION 2/3</div>
    <h2>复述基线</h2><p style="color:#6e7890;font-size:12px">用英文 2-3 句概括刚读文章的核心规则。AI 给基线分。</p>
    <textarea id="cbRetell" style="width:100%;min-height:90px;box-sizing:border-box;border:1px solid #cfd8ea;border-radius:10px;padding:10px;font:inherit"></textarea>
    <button id="cbGrade" style="border:0;background:#101b35;color:#fff;border-radius:10px;padding:10px 20px;font-weight:800;cursor:pointer;margin-top:10px">提交批改</button><div id="cbFb"></div>`);
    $('#cbGrade').onclick=async()=>{const answer=$('#cbRetell').value.trim();if(answer.split(/\s+/).length<10){toast('至少写 10 词');return}
      $('#cbGrade').disabled=true;$('#cbGrade').textContent='…';
      try{const f=await App.grade({kind:'retell',concept:'calibration',prompt:'Restate the main rule of the article you just read.',reference:data.article.reference||'',answer});
        state.retellBaseline=f.term_accuracy??0;persist();
        $('#cbFb').innerHTML=`<div style="margin-top:10px;border-left:2px solid #63c7a6;background:#f2fbf7;padding:9px 12px;font-size:12px">基线分 ${state.retellBaseline} · <b>rewrite</b>: ${esc(f.rewrite||'')}</div><button id="cbNext2" style="border:0;background:#101b35;color:#fff;border-radius:10px;padding:10px 20px;font-weight:800;cursor:pointer;margin-top:10px">下一步</button>`;
        $('#cbNext2').onclick=step3}
      catch(e){$('#cbGrade').disabled=false;$('#cbGrade').textContent='提交批改';toast('批改暂不可用，稍后重试')}}}
  /* 步骤3 词汇覆盖 + profile 写入 */
  function step3(){const qs=data.vocab;
    shell(`<div style="font-size:10px;letter-spacing:.16em;color:#5f82c8;font-weight:800">CALIBRATION 3/3</div><h2>法律义项 · 20 题</h2><p style="color:#6e7890;font-size:12px">选这个词在法律语境里的意思。</p>
    ${qs.map((q,i)=>`<div style="margin:12px 0"><b style="font-size:13px">${i+1}. ${esc(q.word)}</b>${q.options.map((o,j)=>`<label style="display:block;font-size:12.5px;margin:4px 0"><input type="radio" name="v${i}" value="${j}"> ${esc(o)}</label>`).join('')}</div>`).join('')}<button id="cbFin" style="border:0;background:#16785c;color:#fff;border-radius:10px;padding:11px 24px;font-weight:800;cursor:pointer">完成校准</button>`);
    $('#cbFin').onclick=()=>{const right=qs.filter((q,i)=>+wiz.querySelector(`input[name=v${i}]:checked`)?.value===q.answer).length;
      const vocabCoverage=Math.round(right/qs.length*100),wpm=state.wpm,rb=state.retellBaseline;
      let config=wpm<100?{audioLoop:true,retellCount:3,reviewDaily:8,timedReading:'required'}:wpm<130?{audioLoop:true,retellCount:3,reviewDaily:8,timedReading:'optional'}:{audioLoop:false,retellCount:3,reviewDaily:10,timedReading:'optional'};
      if(rb>=80)config={...config,retellCount:Math.max(2,config.retellCount-1),counterargument:true};
      store.profile={date:Date.now(),wpm,retellBaseline:rb,vocabCoverage,config};save();
      window.CloudSync?.logEvent?.('calibration',`wpm ${wpm} · retell ${rb} · vocab ${vocabCoverage}%`);
      wiz.remove();sessionStorage.removeItem('calib');toast(`校准完成：${wpm} wpm · 词汇 ${vocabCoverage}%`);location.reload()}}
  // 入口：侧栏 rail-foot 前注入按钮；welcome 侧入口由 index.html 调 App.startCalibration
  const btn=document.createElement('button');btn.id='calibEntry';btn.className='pill';btn.style.cssText='margin:6px 6px;width:calc(100% - 12px)';btn.textContent='⏱ 新学员校准（20 分钟）';btn.onclick=step1;
  entryHost?.insertBefore(btn,document.querySelector('.rail-foot'));
  App.startCalibration=step1;
  if(sessionStorage.getItem('calib'))step1(); // 中断恢复
}
