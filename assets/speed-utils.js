/* 训练场纯逻辑：阅读速度与 TTS 时间戳映射
   ts: [{begin_time,end_time}] 毫秒；seconds: 秒（audio.currentTime） */
export function mapTimestamps(ts,tokenCount,seconds){
  if(!Array.isArray(ts)||!ts.length||!tokenCount||!Number.isFinite(seconds)||seconds<0)return -1;
  const ms=seconds*1000;
  if(ms<ts[0].begin_time)return -1;
  const last=ts[ts.length-1];
  if(ms>(last.end_time??last.begin_time))return tokenCount-1;
  let lo=0,hi=ts.length-1;
  while(lo<=hi){const mid=(lo+hi)>>1;
    if(ms<ts[mid].begin_time)hi=mid-1;
    else if(ms>ts[mid].end_time)lo=mid+1;
    else{const segStart=ts[mid].begin_time,segEnd=ts[mid].end_time||segStart+1;
      const frac=(ms-segStart)/Math.max(1,segEnd-segStart);
      return Math.min(tokenCount-1,Math.floor((mid+frac)*tokenCount/ts.length))}}
  return Math.min(tokenCount-1,Math.floor(Math.min(lo,ts.length-1)*tokenCount/ts.length));
}
export function wordsPerMinute(wordCount,seconds){return seconds>0?Math.round(wordCount/(seconds/60)):0}
export function countWords(text){return (String(text).trim().match(/[A-Za-z][A-Za-z'’-]*/g)||[]).length}
