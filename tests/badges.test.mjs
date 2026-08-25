import test from 'node:test';import assert from 'node:assert/strict';
import {BADGES,evaluateBadges,streakDays} from '../assets/badges.js';
test('BADGES 共 6 枚且 id 唯一',()=>{
  assert.equal(BADGES.length,6);
  assert.equal(new Set(BADGES.map(b=>b.id)).size,6);
});
test('evaluateBadges 授予满足条件的徽章且不重复',()=>{
  const store={badges:[],retellLog:{10:{0:{feedback:{term_accuracy:100}}}},readingLog:[{wpm:140,verified:true,date:Date.now()}]};
  const got=[];const earned=evaluateBadges(store,b=>got.push(b.id));
  assert.equal(earned,true);
  assert.deepEqual(got.sort(),['certiorari','lead_foot','motion_granted']);
  assert.equal(evaluateBadges(store,()=>{}),false,'second run should not re-grant');
  assert.equal(store.badges.length,3);
});
test('lead_foot 不认未验证的扫读',()=>{
  const store={badges:[],readingLog:[{wpm:400,verified:false}]};
  assert.equal(BADGES.find(b=>b.id==='lead_foot').test(store),false);
});
test('streakDays 跨今昨两天=2',()=>{
  const day=864e5,now=Date.now();
  assert.equal(streakDays({readingLog:[{date:now},{date:now-day}]}),2);
  assert.equal(streakDays({}),0);
});
