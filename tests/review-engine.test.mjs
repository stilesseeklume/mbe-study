import test from 'node:test';import assert from 'node:assert/strict';
import {schedule,mastered,dueToday,pickDaily} from '../assets/review-engine.js';
test('答对间隔阶梯 1→3→7→16→35',()=>{
  assert.equal(schedule({interval:0,streak:0},true).interval,1);
  assert.equal(schedule({interval:1,streak:1},true).interval,3);
  assert.equal(schedule({interval:3,streak:2},true).interval,7);
  assert.equal(schedule({interval:7,streak:3},true).interval,16);
  assert.equal(schedule({interval:16,streak:4},true).interval,35);
});
test('答错归零',()=>{const r=schedule({interval:16,streak:4},false);assert.equal(r.interval,0);assert.equal(r.streak,0)});
test('streak≥5 毕业',()=>{assert.equal(mastered({streak:5}),true);assert.equal(mastered({streak:4}),false)});
test('dueToday 按 dueAt 过滤',()=>{const now=Date.now();
  assert.equal(dueToday([{id:'a',dueAt:now-1},{id:'b',dueAt:now+9e6}],now).length,1)});
test('每日限量默认8',()=>{const now=Date.now(),items=Array.from({length:20},(_,i)=>({id:'w'+i,dueAt:now-1}));
  assert.equal(pickDaily(items,now).length,8)});
