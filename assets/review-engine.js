/* 简化 SM-2：阶梯间隔，答错归零，streak≥5 毕业 */
const LADDER=[1,3,7,16,35];
export function schedule(item,correct){
  if(!correct)return {...item,interval:0,streak:0,dueAt:Date.now()+36e5};
  const streak=item.streak+1;
  const interval=LADDER[Math.min(streak-1,LADDER.length-1)]*(streak>LADDER.length?2:1);
  return {...item,streak,interval,dueAt:Date.now()+interval*864e5};
}
export function mastered(item){return item.streak>=5}
export function dueToday(items,now=Date.now()){return items.filter(i=>i.status!=='mastered'&&i.dueAt<=now)}
export function pickDaily(items,now=Date.now(),limit=8){return dueToday(items,now).slice(0,limit)}
export function upsert(items,entry){const i=items.findIndex(x=>x.id===entry.id);if(i>=0)items[i]={...items[i],...entry};else items.push(entry);return items}
