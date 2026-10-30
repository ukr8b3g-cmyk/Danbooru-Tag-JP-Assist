import {test} from 'node:test';
import assert from 'node:assert/strict';
import {removeStaleTooltips} from '../web/lib/tooltip_cleanup.js';

const tip = (id, positioned=true) => ({id,removed:false,hasAttribute(){return positioned;},remove(){this.removed=true;}});
const owner = (id, visible=true, own=true) => ({$_ptooltipIdAttr:id,isConnected:true,closest(){return own?{}:null;},getClientRects(){return visible?[{}]:[];},getAttribute(){return null;}});
function clean(tooltips, owners, ownedIds=new Set()) {
  globalThis.getComputedStyle=()=>({visibility:'visible'});
  try {removeStaleTooltips({querySelectorAll(selector){return selector.startsWith('.p-tooltip')?tooltips:owners;}},ownedIds);}
  finally {delete globalThis.getComputedStyle;}
}
test('closed Settings removes only previously identified JP Assist tooltips',()=>{
  const tips=[tip('pv_id_207_tooltip',false),tip('pv_id_207_tooltip',false),tip('orphan')];
  clean(tips,[],new Set(['pv_id_207_tooltip']));assert.deepEqual(tips.map(t=>t.removed),[true,true,false]);
});
test('live tooltip stays while duplicate unpositioned copies disappear',()=>{
  const tips=[tip('live',false),tip('live'),tip('live',false),tip('live')];
  clean(tips,[owner('live')]);assert.deepEqual(tips.map(t=>t.removed),[true,false,true,true]);
});
test('hidden and disconnected owners do not keep tooltips alive',()=>{
  const detached=owner('detached');detached.isConnected=false;
  const tips=[tip('hidden'),tip('detached')];clean(tips,[owner('hidden',false),detached]);
  assert.ok(tips.every(t=>t.removed));
});
test('input wrapper and aria ownership preserve ordinary tooltips',()=>{
  const wrapper={...owner(null),querySelector(){return owner('input');}};
  const aria={...owner(null),getAttribute(){return 'first second';}};
  const tips=[tip('input'),tip('first'),tip('second')];clean(tips,[wrapper,aria]);
  assert.ok(tips.every(t=>!t.removed));
});

test('other extensions keep unpositioned, orphaned and duplicate tooltips',()=>{
  const tips=[tip('foreign',false),tip('foreign'),tip('foreign'),tip('orphan',false),tip('',false)];
  clean(tips,[owner('foreign',true,false)]);
  assert.ok(tips.every(t=>!t.removed));
});

test('remembered ownership survives Settings removal without claiming other tooltips',()=>{
  const ownedIds=new Set();
  clean([tip('own')],[owner('own')],ownedIds);
  const tips=[tip('own'),tip('foreign',false)];
  clean(tips,[],ownedIds);
  assert.deepEqual(tips.map(t=>t.removed),[true,false]);
});
