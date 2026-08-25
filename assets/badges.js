/* 法律梗成就：从 store 事实推导，store.badges 只存已获得 id */
export const BADGES=[
  {id:'motion_granted',name:'Motion Granted',desc:'首次完成复述',test:s=>Object.keys(s.retellLog||{}).length>=1},
  {id:'sustained',name:'Sustained',desc:'连续学习 7 天',test:s=>streakDays(s)>=7},
  {id:'case_closed',name:'Case Closed',desc:'完成 10 页输出闭环',test:s=>(s.completed||[]).length>=10},
  {id:'habeas',name:'Habeas Corpus',desc:'10 个词从复习队列毕业',test:s=>(s.reviewQueue||[]).filter(i=>i.status==='mastered').length>=10},
  {id:'certiorari',name:'Certiorari Granted',desc:'单次复述术语准确率 100%',test:s=>Object.values(s.retellLog||{}).flatMap(Object.values).some(e=>e?.feedback?.term_accuracy>=100)},
  {id:'lead_foot',name:'Lead Foot',desc:'净读速度破 130 wpm',test:s=>(s.readingLog||[]).some(r=>r.wpm>=130&&r.verified!==false)}];
export function streakDays(s){
  const stamps=[...(s.readingLog||[]).map(r=>r.date),...(s.notes||[]).map(n=>Date.parse(n.time)||0),
    ...Object.values(s.retellLog||{}).flatMap(Object.values).map(e=>e?.time||0)].filter(Boolean);
  const days=new Set(stamps.map(t=>new Date(t).toDateString()));
  let n=0,d=new Date();
  while(days.has(d.toDateString())){n++;d.setDate(d.getDate()-1)}
  return n;
}
export function evaluateBadges(store,grant){let earned=false;for(const b of BADGES){if(!store.badges.includes(b.id)&&b.test(store)){store.badges.push(b.id);earned=true;grant?.(b)}}return earned}
export function initBadges(App){
  const {store,save,toast}=App;let t=null;
  const run=()=>{if(evaluateBadges(store,b=>toast('🏅 成就解锁：'+b.name)))save()};
  window.addEventListener('usbar:save',()=>{clearTimeout(t);t=setTimeout(run,600)});
}
