import {test} from 'node:test';
import assert from 'node:assert/strict';
import {removeStaleTooltips} from '../web/lib/tooltip_cleanup.js';

const tip = (id, positioned=true) => ({id,removed:false,hasAttribute(){return positioned;},remove(){this.removed=true;}});
const owner = (id, visible=true) => ({$_ptooltipIdAttr:id,isConnected:true,getClientRects(){return visible?[{}]:[];},getAttribute(){return null;}});
function clean(tooltips, owners) {
  globalThis.getComputedStyle=()=>({visibility:'visible'});
  try {removeStaleTooltips({querySelectorAll(selector){return selector.startsWith('.p-tooltip')?tooltips:owners;}});}
  finally {delete globalThis.getComputedStyle;}
}
test('closed Settings removes all orphaned duplicate tooltips',()=>{
  const tips=[tip('pv_id_207_tooltip',false),tip('pv_id_207_tooltip',false),tip('orphan')];
  clean(tips,[]);assert.ok(tips.every(t=>t.removed));
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
