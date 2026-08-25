import test from 'node:test';import assert from 'node:assert/strict';
import {mapTimestamps,wordsPerMinute,countWords} from '../assets/speed-utils.js';
test('等长对齐：当前时间命中的词索引',()=>{
  const ts=[{begin_time:0,end_time:500},{begin_time:500,end_time:1000},{begin_time:1000,end_time:2000}];
  assert.equal(mapTimestamps(ts,3,0.25),0);
  assert.equal(mapTimestamps(ts,3,0.6),1);
  assert.equal(mapTimestamps(ts,3,1.5),2);
});
test('词数不等时按比例映射（归一化）',()=>{
  const ts=[{begin_time:0,end_time:100},{begin_time:100,end_time:200}];
  assert.equal(mapTimestamps(ts,4,0.05),1);assert.equal(mapTimestamps(ts,4,0.15),3);
});
test('越界与空时间戳返回-1（回退插值）',()=>{
  assert.equal(mapTimestamps([],3,100),-1);
  assert.equal(mapTimestamps([{begin_time:0,end_time:100}],2,-5),-1);
});
test('尾部静音停留在最后一词',()=>{
  const ts=[{begin_time:0,end_time:100},{begin_time:100,end_time:200}];
  assert.equal(mapTimestamps(ts,3,0.9),2);
});
test('wpm 与词数工具',()=>{
  assert.equal(wordsPerMinute(200,120),100);
  assert.equal(wordsPerMinute(0,60),0);
  assert.equal(countWords('The court held that Marbury v. Madison'),7);
  assert.equal(countWords('  '),0);
});
