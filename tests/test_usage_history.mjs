import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUsageHistory, candidateKey, USAGE_STORAGE_KEY, MAX_USAGE_ENTRIES} from '../web/lib/usage_history.js';

const candidate = {tag:'blue_hair',meta:{source_file:'a.csv',source_type:'tag',category_scheme:'danbooru',insert_mode:'tag'}};
function memory() {
  const data=new Map();
  return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
}

test('history persists canonical choices, shares aliases and isolates source dictionaries',()=>{
  const store=memory();
  const first=createUsageHistory({storage:()=>store});
  first.record(candidate);first.record({...candidate,ja:'青髪',aliases:'bluehair'});
  const second=createUsageHistory({storage:()=>store});
  second.record({...candidate,meta:{...candidate.meta,source_file:'b.csv'}});
  assert.equal(new Map(second.entries()).get(candidateKey(candidate)),2);
  assert.equal(second.entries().length,2);
  assert.equal(JSON.parse(store.getItem(USAGE_STORAGE_KEY)).entries.some(([key])=>key.includes('青髪')),false);
  second.clear();assert.deepEqual(first.entries(),[]);
});

test('invalid saved history and denied storage leave completion history usable',()=>{
  const store=memory();store.setItem(USAGE_STORAGE_KEY,'not JSON');
  const h=createUsageHistory({storage:()=>store});assert.deepEqual(h.entries(),[]);h.record(candidate);assert.equal(h.entries()[0][1],1);
  store.setItem(USAGE_STORAGE_KEY,JSON.stringify({version:1,entries:[['bad',1],[candidateKey(candidate),-1],[candidateKey(candidate),Infinity]]}));
  assert.deepEqual(h.entries(),[]);
  const denied=createUsageHistory({storage:()=>{throw new Error('SecurityError');}});
  denied.record(candidate);denied.record(candidate);assert.equal(denied.entries()[0][1],2);
  denied.clear();assert.deepEqual(denied.entries(),[]);
});

test('history is bounded by recent selections and does not affect unrelated storage',()=>{
  const store=memory();store.setItem('user settings','preserve');
  const entries=Array.from({length:MAX_USAGE_ENTRIES},(_,i)=>[candidateKey({...candidate,tag:`tag_${i}`}),i+1]);
  store.setItem(USAGE_STORAGE_KEY,JSON.stringify({version:1,entries}));
  const h=createUsageHistory({storage:()=>store});h.record(candidate);
  assert.equal(h.entries().length,MAX_USAGE_ENTRIES);
  assert.equal(h.entries()[0][0],entries[1][0]);
  h.clear();assert.equal(store.getItem('user settings'),'preserve');
});

test('another tab changing or clearing history invalidates searches',()=>{
  const events=new EventTarget();let changes=0;
  const h=createUsageHistory({storage:()=>memory(),events,onChange:()=>changes++});
  for(const key of [USAGE_STORAGE_KEY,null,'unrelated']) events.dispatchEvent(Object.assign(new Event('storage'),{key}));
  assert.equal(changes,2);h.dispose();
  events.dispatchEvent(Object.assign(new Event('storage'),{key:USAGE_STORAGE_KEY}));assert.equal(changes,2);
});
