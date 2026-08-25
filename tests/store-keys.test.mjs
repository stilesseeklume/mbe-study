import test from 'node:test';import assert from 'node:assert/strict';
const src=await import('fs').then(fs=>fs.promises.readFile(new URL('../assets/cloud-sync.js',import.meta.url),'utf8'));
test('SYNC_KEYS 覆盖全部训练场新键',()=>{
  const need=['page','completed','notes','highlights','edits','savedWords','apiEndpoint','retellLog','reviewQueue','lookupLog','badges','profile','readingLog','zhExpand'];
  for(const k of need)assert.ok(new RegExp(`'${k}'`).test(src),`SYNC_KEYS 缺 ${k}`);
});
