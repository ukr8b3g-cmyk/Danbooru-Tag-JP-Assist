import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {setMaxListeners} from 'node:events';
import { addLocalizedSetting, localizedDefinition, uiText, onLocaleChange } from '../web/lib/settings_i18n.js';
import { createUsageHistory, USAGE_STORAGE_KEY, candidateKey } from '../web/lib/usage_history.js';
import { createCandidateList } from '../web/lib/candidate_list.js';
import * as core from '../web/lib/completion_core.js';

class Element extends EventTarget {
  constructor() {super();this.style={display:'none'};this.children=[];this.isConnected=true;this.value='';this.attributes={};this.scrollTop=0;this.clientHeight=240;}
  setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name]??null;}
  append(...els){this.children.push(...els);}
  appendChild(el){this.append(el);return el;}
  replaceChildren(...els){this.children=[];this.append(...els);}
  contains(el){return this===el || this.children.some(child=>child.contains?.(el));}
  remove(){this.isConnected=false;}
  closest(){return null;}
  querySelectorAll(){return [];}
  querySelector(){return null;}
  getBoundingClientRect(){return {left:10,bottom:100,width:500,height:40};}
  scrollIntoView(){}
}
class Textarea extends Element {
  constructor(){super();this.selectionStart=0;this.selectionEnd=0;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.setSelectionRange(start+text.length,start+text.length);}
}
const event = (name,props={})=>Object.assign(new Event(name,{cancelable:true}),props);
const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const item = {tag:'blue',meta:{source_type:'natural_language',insert_mode:'word',insert_text:'blue'}};

async function fixture({delay=0,orderedSelection=true,usageRanking=true,usageStorage=new Map(),savedSort,savedSettings={},fileListFailsOnce=false,suggestions=[item],tagFiles=['a.csv','b.csv','All'],requestFrame=fn=>setTimeout(fn,0),placePopup=()=>{}}={}) {
  const window=Object.assign(new EventTarget(),{innerWidth:1000,innerHeight:800});
  const document = new Element();
  document.body=new Element();
  document.createElement=()=>Object.assign(new Element(),{ownerDocument:document});
  document.createDocumentFragment=()=>new Element();
  document.execCommand=(_cmd,_show,text)=>{
    const area=document.activeElement;
    area.setRangeText(text,area.selectionStart,area.selectionEnd);
    area.dispatchEvent(event('input',{inputType:'insertText'}));
    return true;
  };
  const settings=new Map(Object.entries(savedSettings));
  if(savedSort !== undefined) settings.set("DanbooruTagJPAssist.SortOrder",savedSort);
  const definitions=new Map();
  let extension;
  let observerCallback = null;
  let revision='r1';
  let fail=false;
  const calls=[];
  const settingEvents = new EventTarget();
  const app={ui:{settings:Object.assign(settingEvents,{addSetting(def){definitions.set(def.id,def);if(typeof def.type!=='function' && !settings.has(def.id)) settings.set(def.id,def.defaultValue);},getSettingValue(id){return settings.get(id);},async setSettingValueAsync(id,value){settings.set(id,value);definitions.get(id)?.onChange?.(value);}})},registerExtension(ext){extension=ext;}};
  const storage={getItem:key=>usageStorage.get(key)??null,setItem:(key,value)=>usageStorage.set(key,value),removeItem:key=>usageStorage.delete(key)};
  const fetch=async (url,options)=>{
    calls.push({url,...options});
    if(url.includes('/files')) {
      if(fileListFailsOnce) {fileListFailsOnce=false;throw new Error('file list temporarily unavailable');}
      return {ok:true,json:async()=>({tag_files:tagFiles,translation_files:['ja.csv','nl.csv','All'],ordered_selection:orderedSelection,usage_ranking:usageRanking})};
    }
    if(url.includes('/revision'))return {ok:true,json:async()=>({revision,ordered_selection:orderedSelection,usage_ranking:usageRanking})};
    if(url.includes('/hf-update'))return {ok:true,json:async()=>({updated:false})};
    if(delay)await wait(delay); // Deliberately ignore AbortSignal to model an already queued response.
    if(fail)throw new Error('offline');
    return {ok:true,json:async()=>({tags:suggestions,revision})};
  };
  const context=vm.createContext({app,core,addLocalizedSetting,localizedDefinition,uiText,onLocaleChange,createCandidateList,createUsageHistory:options=>createUsageHistory({...options,storage:()=>storage,events:window}),installPopupResize:()=>({handle:new Element(),place:placePopup,cancel(){}}),document,Element,HTMLTextAreaElement:Textarea,AbortController,Event,InputEvent:Event,URLSearchParams,Map,Set,WeakMap,WeakSet,console,fetch,setTimeout,clearTimeout,window,requestAnimationFrame:requestFrame,MutationObserver:class{constructor(callback){observerCallback=callback;}observe(){}}});
  let source=await readFile(new URL('../web/danbooru_tag_jp_assist.js',import.meta.url),'utf8');
  source=source.replace(/^import .*$/gm,'').replace('const API_URLS', 'const {inputContext,snapshotMatches,insertionEdit}=core;\nconst API_URLS');
  vm.runInContext(source,context);
  await extension.init();
  await wait(5);
  const area=new Textarea();
  const node={widgets:[{inputEl:area}],onRemoved(){node.originalRemoved=true;}};
  document.activeElement=area;
  extension.nodeCreated(node);
  const popup=()=>document.body.children.filter(el=>el.isConnected&&el.style.display==='block').at(-1);
  const type=text=>{area.value=text;area.setSelectionRange(text.length,text.length);area.dispatchEvent(event('input'));};
  const key=(key,props={})=>{const e=event('keydown',{key,...props});area.dispatchEvent(e);return e;};
  const setting=(name,value)=>{const id=`DanbooruTagJPAssist.${name}`;settings.set(id,value);definitions.get(id).onChange?.(value);};
  const mountFiles=kind=>{
    const name=`${kind}Files`;
    const def=definitions.get(`DanbooruTagJPAssist.${name}`);
    const root=def.type(def.name,value=>setting(name,value),settings.get(def.id)??def.defaultValue);
    document.body.append(root);
    return root;
  };
  return {settingEvents,window,document,node,area,popup,type,key,setting,calls,extension,setRevision:v=>revision=v,offline:()=>fail=true,definitions,mountFiles,settings,usageStorage,
    notifyMutation:(addedNodes)=>observerCallback?.([{addedNodes}])};
}

test('hidden textareas reserve no frames for wheel or canvas dragging',async()=>{
  const frames=[];
  const f=await fixture({requestFrame:fn=>frames.push(fn)});
  setMaxListeners(0,f.window,f.document);
  const nodes=[f.node];
  for(let i=1;i<100;i++) {
    const node={widgets:[{inputEl:new Textarea()}]};f.extension.nodeCreated(node);nodes.push(node);
  }
  frames.splice(0).forEach(fn=>fn());
  f.window.dispatchEvent(event('wheel'));
  f.window.dispatchEvent(event('pointermove',{buttons:1}));
  assert.equal(frames.length,0);
  for(const node of nodes)node.onRemoved();
  f.window.dispatchEvent(event('wheel'));assert.equal(frames.length,0);
});

test('visible popup coalesces wheel and drag frames and ignores queued work after dismissal',async()=>{
  const frames=[];let placements=0;
  const f=await fixture({requestFrame:fn=>frames.push(fn),placePopup:()=>placements++});
  frames.splice(0).forEach(fn=>fn());
  f.type('blu');await wait(115);assert.ok(f.popup());placements=0;
  f.popup().scrollTop=600;
  f.window.dispatchEvent(event('wheel'));f.window.dispatchEvent(event('wheel'));
  f.window.dispatchEvent(event('pointermove',{buttons:1}));
  assert.equal(frames.length,1);assert.equal(placements,0);
  frames.shift()();assert.equal(placements,1);assert.equal(f.popup().scrollTop,600);
  f.area.dispatchEvent(event('scroll'));f.window.dispatchEvent(event('resize'));
  assert.equal(placements,3);
  f.window.dispatchEvent(event('wheel'));f.key('Escape');frames.shift()();
  assert.equal(placements,3);assert.equal(f.popup(),undefined);
  f.type('blu');await wait(115);assert.ok(f.popup());placements=0;
  f.window.dispatchEvent(event('wheel'));f.node.onRemoved();frames.shift()();
  assert.equal(placements,0);assert.equal(f.popup(),undefined);
});

test('Escape invalidates a pending search even before a popup exists',async()=>{
  const f=await fixture({delay:50});f.type('blu');await wait(95);f.key('Escape');await wait(70);assert.equal(f.popup(),undefined);assert.equal(f.area.value,'blu');f.node.onRemoved();
});
test('cursor changes cannot commit an obsolete range',async()=>{
  const f=await fixture();f.type('blu');await wait(110);assert.ok(f.popup());f.area.setSelectionRange(1,1);const e=f.key('Enter');assert.equal(e.defaultPrevented,false);assert.equal(f.area.value,'blu');assert.equal(f.popup(),undefined);f.node.onRemoved();
});
test('window pointer events and blur do not commit pending suggestions',async()=>{
  const f=await fixture({delay:50});
  f.type('blu');await wait(95);
  f.window.dispatchEvent(event('pointerdown',{clientX:20,clientY:20}));
  f.document.activeElement=f.document.body;
  f.area.dispatchEvent(event('blur',{relatedTarget:f.document.body}));
  await wait(70);
  assert.equal(f.popup(),undefined);
  assert.equal(f.area.value,'blu');
  f.node.onRemoved();
  f.window.dispatchEvent(event('pointerup'));
});
test('candidate mouse selection inserts once and keeps the caret',async()=>{
  const f=await fixture();f.setting('CompletionBehavior','csv');
  f.type('blu');await wait(110);
  const popup=f.popup();assert.ok(popup);
  const candidate=descendants(popup).find(el=>el.style.cssText?.includes('cursor:pointer'));
  assert.ok(candidate);
  assert.equal(f.area.value,'blu');
  const select=event('mousedown');candidate.dispatchEvent(select);
  assert.equal(select.defaultPrevented,true);
  assert.equal(f.area.value,'blue ');
  assert.equal(f.area.selectionStart,5);
  assert.equal(f.area.selectionEnd,5);
  assert.equal(f.popup(),undefined);
  f.node.onRemoved();
});
test('IME Enter is left to the input method and the next independent Enter commits',async()=>{
  const f=await fixture();f.setting('CompletionBehavior','csv');f.type('blu');await wait(100);f.area.dispatchEvent(event('compositionstart'));assert.equal(f.key('Enter',{isComposing:true}).defaultPrevented,false);f.area.dispatchEvent(event('compositionend'));await wait(110);assert.equal(f.key('Enter').defaultPrevented,false);f.area.dispatchEvent(event('keyup',{key:'Enter'}));assert.equal(f.key('Enter').defaultPrevented,true);assert.equal(f.area.value,'blue ');await wait(110);assert.equal(f.popup(),undefined);f.node.onRemoved();
});
test('settings invalidate a delayed response',async()=>{
  const f=await fixture({delay:50});f.type('blu');await wait(95);f.setting('SearchJapanese',false);await wait(70);assert.equal(f.popup(),undefined);f.node.onRemoved();
});
test('node removal preserves previous hook and removes popup/listeners',async()=>{
  const f=await fixture({delay:50});f.type('blu');await wait(95);f.node.onRemoved();await wait(70);assert.equal(f.node.originalRemoved,true);assert.equal(f.document.body.children.filter(el=>el.isConnected).length,0);f.type('other');await wait(100);assert.equal(f.popup(),undefined);
});
test('dictionary revision refreshes successful cached results',async()=>{
  const f=await fixture();f.type('blu');await wait(110);f.key('Escape');f.setRevision('r2');f.type('blu');await wait(110);assert.equal(f.calls.filter(call=>call.url.includes('/tags?')).length,2);f.node.onRemoved();
});
test('offline input remains editable and failed results are not cached',async()=>{
  const f=await fixture();f.offline();f.type('blu');await wait(110);assert.equal(f.popup(),undefined);f.type('blu');await wait(110);assert.equal(f.area.value,'blu');assert.equal(f.calls.filter(call=>call.url.includes('/tags?')).length,2);f.node.onRemoved();
});
test('all new preferences belong to the existing settings category',async()=>{
  const f=await fixture();for(const def of f.definitions.values())assert.equal(def.category[0],'Danbooru Tag JP Assist');assert.equal(f.definitions.get('DanbooruTagJPAssist.CompletionBehavior').defaultValue,'existing');f.node.onRemoved();
});

test('500 candidates use a bounded window and the last candidate remains keyboard selectable',async()=>{
  const f=await fixture({suggestions:Array.from({length:500},(_,i)=>({tag:`item_${i}`}))});
  f.type('item');await wait(115);const popup=f.popup();assert.ok(popup);
  const rows=()=>descendants(popup).filter(el=>el.style.cssText?.includes('cursor:pointer'));
  assert.ok(rows().length<30);
  popup.scrollTop=19600;popup.dispatchEvent(event('scroll'));
  assert.ok(rows().some(row=>row.children[0].textContent==='item_499'));
  popup.clientHeight=2000;popup.dispatchEvent(event('scroll'));
  assert.ok(rows().length<80);
  for(let i=0;i<499;i++)f.key('ArrowDown');
  assert.equal(f.key('Enter').defaultPrevented,true);
  assert.equal(f.area.value,'item 499, ');assert.equal(f.popup(),undefined);f.node.onRemoved();
});
test('Ctrl+Enter is not consumed and readonly changes cannot insert',async()=>{
  const f=await fixture();f.type('blu');await wait(110);assert.equal(f.key('Enter',{ctrlKey:true}).defaultPrevented,false);f.area.readOnly=true;assert.equal(f.key('Enter').defaultPrevented,false);assert.equal(f.area.value,'blu');f.node.onRemoved();
});
test('new typing after dismissal does not reuse the previous selection snapshot',async()=>{
  const f=await fixture();f.type('blu');await wait(110);assert.ok(f.popup());f.key('Escape');f.type('bl');f.document.dispatchEvent(event('selectionchange'));await wait(110);assert.ok(f.popup());f.node.onRemoved();
});

test('legacy mode omits selected lists; selected tag and translation modes send independent ordered arrays',async()=>{
  const f=await fixture({savedSettings:{'DanbooruTagJPAssist.TagSelectionMode':'legacy','DanbooruTagJPAssist.TranslationSelectionMode':'legacy'}});f.type('blu');await wait(110);
  let params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
  assert.equal(params.has('tag_files'),false);assert.equal(params.has('translation_files'),false);
  f.setting('TagFiles',['b.csv','a.csv']);f.setting('TagSelectionMode','selected');
  f.type('blu');await wait(110);
  params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
  assert.deepEqual(JSON.parse(params.get('tag_files')),['b.csv','a.csv']);assert.equal(params.has('translation_files'),false);
  f.setting('TranslationSelectionMode','selected');f.setting('TranslationFiles',[]);f.type('blu');await wait(110);
  params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
  assert.equal(params.get('translation_files'),'[]');f.node.onRemoved();
});

const descendants=root=>[root,...root.children.flatMap(descendants)];

test('new and cached candidate lists reopen at the top after manual scrolling',async()=>{
  const f=await fixture({suggestions:Array.from({length:40},(_,i)=>({tag:`item_${i}`}))});
  f.type('a');await wait(115);
  for(const text of ['b','a','test, a']) {
    f.popup().scrollTop=600;
    f.type(text);await wait(115);
    assert.equal(f.popup().scrollTop,0,text);
  }
  f.popup().scrollTop=600;f.key('Escape');f.type('test, a');await wait(115);
  assert.equal(f.popup().scrollTop,0,'reopen after Escape');f.node.onRemoved();
});

test('browsing and appearance updates retain scroll while arrow navigation stays active',async()=>{
  const f=await fixture({suggestions:Array.from({length:40},(_,i)=>({tag:`item_${i}`}))});
  f.type('a');await wait(115);const popup=f.popup();popup.scrollTop=600;
  f.setting('PopupTheme','amber');assert.equal(popup.scrollTop,600);
  await wait(115);assert.equal(popup.scrollTop,600);
  const visited=[];const original=Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView=function(){visited.push(this.children[0].textContent);};
  try {f.key('ArrowDown');f.key('ArrowUp');assert.deepEqual(visited,['item_1','item_0']);}
  finally {Element.prototype.scrollIntoView=original;}
  assert.equal(popup.scrollTop,0);f.node.onRemoved();
});

test('word unit sends one-letter queries and commits only after the confirmed space',async()=>{
  for (const [letter,tag] of [['a','apple'],['b','blue_hair']]) {
    const f=await fixture({suggestions:[{tag}]});f.setting('CompletionUnit','word');
    f.type(`with pokeball ${letter}`);await wait(115);
    const params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
    assert.equal(params.get('q'),letter);assert.equal(params.get('tail'),letter);
    assert.ok(f.popup());assert.equal(f.key('Enter').defaultPrevented,true);
    assert.equal(f.area.value,`with pokeball ${tag.replaceAll('_',' ')}, `);
    f.type(`with pokeball ${tag.replaceAll('_',' ')} a`);await wait(115);
    assert.equal(new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams.get('q'),'a');
    f.node.onRemoved();
  }
});

test('word unit searches neither an empty new word nor active IME composition',async()=>{
  const f=await fixture();f.setting('CompletionUnit','word');
  f.type('with pokeball ');await wait(110);
  assert.equal(f.calls.filter(c=>c.url.includes('/tags?')).length,0);
  f.area.dispatchEvent(event('compositionstart'));f.type('with pokeball b');await wait(110);
  assert.equal(f.calls.filter(c=>c.url.includes('/tags?')).length,0);
  f.node.onRemoved();
});

test('word unit is the default while saved tag mode is preserved and switching invalidates searches',async()=>{
  const f=await fixture({delay:50,savedSettings:{'DanbooruTagJPAssist.CompletionUnit':'tag'}});
  assert.equal(f.definitions.get('DanbooruTagJPAssist.CompletionUnit').defaultValue,'word');
  assert.equal(f.settings.get('DanbooruTagJPAssist.CompletionUnit'),'tag');
  f.type('with pokeball b');await wait(95);f.setting('CompletionUnit','word');await wait(70);
  assert.equal(f.popup(),undefined);f.type('with pokeball b');await wait(160);
  assert.ok(f.popup());assert.equal(f.key('Enter').defaultPrevented,true);
  assert.equal(f.area.value,'with pokeball blue, ');f.node.onRemoved();
});

test('unsaved word default searches and inserts after both spaces and commas without setup',async()=>{
  for (const separator of [' ', ', ']) {
    const f=await fixture({suggestions:[{tag:'apple'}]});
    f.type(`test${separator}a`);await wait(115);
    const params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
    assert.equal(params.get('q'),'a');assert.ok(f.popup());f.key('Enter');
    assert.equal(f.area.value,`test${separator}apple, `);f.node.onRemoved();
  }
});

test('Settings checkboxes persist selection order and arrows reorder without including All',async()=>{
  const f=await fixture({savedSettings:{'DanbooruTagJPAssist.TagFiles':[]}});const root=f.mountFiles('Tag');
  const find=label=>descendants(root).find(el=>el.attributes['aria-label']===label);
  const choose=name=>{const check=find(`Select tag CSV ${name}`);check.checked=true;check.dispatchEvent(event('change'));};
  choose('b.csv');choose('a.csv');
  assert.deepEqual(Array.from(f.settings.get('DanbooruTagJPAssist.TagFiles')),['b.csv','a.csv']);
  find('Move tag CSV a.csv up').dispatchEvent(event('click'));
  assert.deepEqual(Array.from(f.settings.get('DanbooruTagJPAssist.TagFiles')),['a.csv','b.csv']);
  assert.equal(find('Select tag CSV All'),undefined);
  const rebuilt=f.mountFiles('Tag');
  assert.equal(descendants(rebuilt).find(el=>el.attributes['aria-label']==='Select tag CSV a.csv').checked,true);
  f.node.onRemoved();
});

test('selection order changes invalidate pending searches and cached results',async()=>{
  const f=await fixture({delay:50});f.setting('TagSelectionMode','selected');f.setting('TagFiles',['a.csv','b.csv']);f.type('blu');await wait(95);
  f.setting('TagFiles',['b.csv','a.csv']);await wait(70);assert.equal(f.popup(),undefined);
  f.type('blu');await wait(150);assert.ok(f.popup());
  const params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
  assert.equal(params.get('tag_files'),'["b.csv","a.csv"]');f.node.onRemoved();
});

test('selected mode never silently searches all files on a backend needing restart',async()=>{
  const f=await fixture({orderedSelection:false});f.setting('TagSelectionMode','selected');f.setting('TagFiles',['a.csv']);f.type('blu');await wait(110);
  assert.equal(f.popup(),undefined);assert.equal(f.calls.filter(c=>c.url.includes('/tags?')).length,0);f.node.onRemoved();
});

// Appearance preferences must not trigger expensive dictionary reloads.
test('appearance changes re-render a visible popup without repeating tag search',async()=>{
  const f=await fixture();f.type('blu');await wait(115);
  assert.ok(f.popup());
  const before=f.calls.filter(call=>call.url.includes('/tags?')).length;
  f.setting('PopupTheme','amber');
  assert.equal(f.popup().style.borderColor,'#d89b28');
  f.setting('ShowJapanese',false);
  assert.ok(f.popup());
  f.key('Escape'); f.type('blu');await wait(115);
  assert.equal(f.calls.filter(call=>call.url.includes('/tags?')).length,before);
  f.node.onRemoved();
});

test('body mutation batches delayed node scans into a single animation frame',async()=>{
  const f=await fixture();
  let inspected=0;const extra=[];
  for(let i=0;i<25;i++){
    const n={get widgets(){inspected++;return [];}};
    extra.push(n);f.extension.nodeCreated(n);
  }
  await wait(15);
  inspected=0;
  f.notifyMutation([new Textarea()]);
  assert.equal(inspected,0, 'mutation observer should not scan synchronously');
  await wait(15);
  assert.equal(inspected,25);
  for(const n of extra)n.onRemoved();
  f.node.onRemoved();
});

// Model the document-level outside-widget handler used by ComfyUI DomWidget.
function mouseDownThroughDocument(target, document) {
  const e=event('mousedown');
  let stopped=false;
  const stop=e.stopPropagation.bind(e);
  e.stopPropagation=()=>{stopped=true;stop();};
  target.dispatchEvent(e);
  if(!stopped) {
    const bubbled=event('mousedown');
    Object.defineProperty(bubbled,'target',{value:target});
    document.dispatchEvent(bubbled);
  }
  return e;
}

test('scrollbar mousedown keeps the popup open without cancelling native scrolling',async()=>{
  const f=await fixture();f.setting('CompletionBehavior','csv');
  let outsideWidgetClicks=0;
  f.document.addEventListener('mousedown',e=>{
    if(!f.area.contains(e.target)) {
      outsideWidgetClicks++;
      f.document.activeElement=f.document.body;
      f.area.dispatchEvent(event('blur'));
    }
  });
  f.type('blu');await wait(110);
  const popup=f.popup();assert.ok(popup);
  // Native scrollbar presses target the scroll container itself.
  const down=mouseDownThroughDocument(popup,f.document);
  assert.equal(down.defaultPrevented,false);
  assert.equal(outsideWidgetClicks,0);
  assert.equal(f.document.activeElement,f.area);
  assert.equal(f.popup(),popup);
  assert.equal(f.area.value,'blu');
  assert.equal(f.area.selectionStart,3);
  f.window.dispatchEvent(event('pointerup'));
  assert.equal(f.popup(),popup);
  const candidate=descendants(popup).find(el=>el.style.cssText?.includes('cursor:pointer'));
  mouseDownThroughDocument(candidate,f.document);
  assert.equal(f.area.value,'blue ');
  assert.equal(f.area.selectionStart,5);
  f.type('blu');await wait(110);
  mouseDownThroughDocument(f.document.body,f.document);
  assert.equal(outsideWidgetClicks,1);
  assert.equal(f.popup(),undefined);
  assert.equal(f.area.value,'blu');
  f.node.onRemoved();
});

test('real focus loss still dismisses a popup after scrollbar interaction',async()=>{
  const f=await fixture();f.type('blu');await wait(110);
  mouseDownThroughDocument(f.popup(),f.document);
  assert.ok(f.popup());
  f.document.activeElement=f.document.body;
  f.area.dispatchEvent(event('blur',{relatedTarget:f.document.body}));
  assert.equal(f.popup(),undefined);
  assert.equal(f.area.value,'blu');
  f.node.onRemoved();
});

test('both CSV selectors default to selected mode with available files checked',async()=>{
  const f=await fixture();
  for(const kind of ['Tag','Translation']) {
    assert.equal(f.definitions.get(`DanbooruTagJPAssist.${kind}SelectionMode`).defaultValue,'selected');
    const root=f.mountFiles(kind);
    const checks=descendants(root).filter(el=>el.attributes['aria-label']?.startsWith(`Select ${kind.toLowerCase()} CSV `));
    assert.equal(checks.length,2);
    assert.ok(checks.every(el=>el.checked));
  }
  f.type('blu');await wait(110);
  const params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
  assert.deepEqual(JSON.parse(params.get('tag_files')),['a.csv','b.csv']);
  assert.deepEqual(JSON.parse(params.get('translation_files')),['ja.csv','nl.csv']);
  f.node.onRemoved();
});

test('saved selections including empty lists override the new defaults',async()=>{
  const f=await fixture({savedSettings:{'DanbooruTagJPAssist.TagFiles':['b.csv'],'DanbooruTagJPAssist.TranslationFiles':[]}});
  f.type('blu');await wait(110);
  const params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
  assert.deepEqual(JSON.parse(params.get('tag_files')),['b.csv']);
  assert.deepEqual(JSON.parse(params.get('translation_files')),[]);
  assert.ok(descendants(f.mountFiles('Translation')).filter(el=>el.attributes['aria-label']?.startsWith('Select translation CSV ')).every(el=>!el.checked));
  f.node.onRemoved();
});

test('dictionary reload recovers unsaved defaults after an initial file-list failure',async()=>{
  const f=await fixture({fileListFailsOnce:true,savedSettings:{'DanbooruTagJPAssist.TranslationFiles':[]}});
  const root=f.mountFiles('Tag');
  const button=f.definitions.get('DanbooruTagJPAssist.ReloadDictionaries').type();
  await button.onclick();
  const checks=descendants(root).filter(el=>el.attributes['aria-label']?.startsWith('Select tag CSV '));
  assert.equal(checks.length,2);assert.ok(checks.every(el=>el.checked));
  f.type('blu');await wait(110);
  const params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
  assert.deepEqual(JSON.parse(params.get('tag_files')),['a.csv','b.csv']);
  assert.deepEqual(JSON.parse(params.get('translation_files')),[]);
  f.node.onRemoved();
});

test('candidate selection keeps focus through ComfyUI outside-widget dismissal',async()=>{
  const f=await fixture();f.setting('CompletionBehavior','csv');
  f.document.addEventListener('mousedown',e=>{
    if(!f.area.contains(e.target)) {
      f.document.activeElement=f.document.body;
      f.area.dispatchEvent(event('blur'));
    }
  });
  f.type('blu');await wait(110);
  const candidate=descendants(f.popup()).find(el=>el.style.cssText?.includes('cursor:pointer'));
  mouseDownThroughDocument(candidate,f.document);
  assert.equal(f.document.activeElement,f.area);
  assert.equal(f.area.value,'blue ');
  f.document.execCommand('insertText',false,'sky');
  assert.equal(f.area.value,'blue sky');
  mouseDownThroughDocument(f.document.body,f.document);
  assert.equal(f.document.activeElement,f.document.body);
  await wait(110);
  assert.equal(f.popup(),undefined);
  f.node.onRemoved();
});

test('count is the default search order while saved choices win',async()=>{
  for(const savedSort of [undefined,'match','az']) {
    const f=await fixture({savedSort});
    assert.equal(f.definitions.get('DanbooruTagJPAssist.SortOrder').defaultValue,'count');
    f.type('blu');await wait(110);
    const request=f.calls.find(call=>call.url.includes('/tags?'));
    assert.equal(new URL(request.url,'http://localhost').searchParams.get('sort'),savedSort??'count');
    f.node.onRemoved();
  }
});
function frameFixture(f) {
  class FrameArea extends Element {
    constructor(){super();this.selectionStart=0;this.selectionEnd=0;this.tagName='TEXTAREA';}
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
    setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.setSelectionRange(start+text.length,start+text.length);}
  }
  const frame=new Element();frame.tagName='IFRAME';
  const view=Object.assign(new EventTarget(),{innerWidth:640,innerHeight:900,frameElement:frame,HTMLTextAreaElement:FrameArea,Element});
  const doc=new Element();doc.defaultView=view;doc.body=new Element();doc.body.ownerDocument=doc;
  doc.body.querySelectorAll=selector=>selector==='textarea'?doc.body.children.filter(e=>e instanceof FrameArea):[];
  doc.createElement=()=>Object.assign(new Element(),{ownerDocument:doc});doc.createDocumentFragment=()=>new Element();
  doc.execCommand=(_cmd,_show,text)=>{const area=doc.activeElement;area.setRangeText(text,area.selectionStart,area.selectionEnd);area.dispatchEvent(event('input',{inputType:'insertText'}));return true;};
  const area=new FrameArea();area.ownerDocument=doc;doc.activeElement=area;doc.body.append(area);frame.contentDocument=doc;f.document.activeElement=frame;
  f.node.widgets.push({element:frame});f.extension.loadedGraphNode(f.node);
  return {frame,doc,area,addArea(){const area=new FrameArea();area.ownerDocument=doc;doc.body.append(area);return area;},type(text,target=area){doc.activeElement=target;target.value=text;target.setSelectionRange(text.length,text.length);target.dispatchEvent(event('input'));},popup(){return doc.body.children.find(e=>e.className==='jp-tag-ac-popup'&&e.isConnected&&e.style.display==='block');}};
}

test('same-origin iframe completion uses its own document, without editing the parent textarea',async()=>{
 const f=await fixture();f.setting('CompletionBehavior','csv');f.area.value='parent preserved';const child=frameFixture(f);
 child.type('blu');await wait(110);assert.ok(child.popup());
 child.area.dispatchEvent(event('keydown',{key:'Enter'}));assert.equal(child.area.value,'blue ');assert.equal(f.area.value,'parent preserved');assert.equal(child.doc.activeElement,child.area);
 f.node.onRemoved();assert.equal(child.doc.body.children.filter(e=>e.className==='jp-tag-ac-popup'&&e.isConnected).length,0);
});

test('iframe selection changes invalidate candidates and dynamic inputs attach without duplicates',async()=>{
 const f=await fixture();const child=frameFixture(f);child.type('blu');await wait(110);assert.ok(child.popup());child.area.setSelectionRange(1,1);child.doc.dispatchEvent(event('selectionchange'));assert.equal(child.popup(),undefined);
 const second=child.addArea();child.type('blu',second);f.notifyMutation([second]);await wait(130);f.extension.loadedGraphNode(f.node);assert.ok(child.popup());assert.equal(child.doc.body.children.filter(e=>e.className==='jp-tag-ac-popup'&&e.isConnected).length,2);f.node.onRemoved();
});

test('iframe reload and node removal clean up controllers even if old document nodes stay connected',async()=>{
 const f=await fixture();const old=frameFixture(f);old.type('blu');await wait(110);assert.ok(old.popup());
 old.frame.contentDocument=null;old.frame.dispatchEvent(event('load'));assert.equal(old.popup(),undefined); // Navigation may briefly have no body.
 const replacement=frameFixture(f);old.frame.contentDocument=replacement.doc;old.frame.dispatchEvent(event('load'));
 assert.equal(old.area.isConnected,true);assert.equal(old.popup(),undefined);const before=f.calls.length;old.type('blu');await wait(110);assert.equal(f.calls.length,before);
 f.node.onRemoved();const stopped=f.calls.length;replacement.type('blu');await wait(110);assert.equal(f.calls.length,stopped);
});

test('cross-origin iframe is skipped while ordinary textarea completion still works',async()=>{
 const f=await fixture();const frame=new Element();frame.tagName='IFRAME';Object.defineProperty(frame,'contentDocument',{get(){throw new Error('SecurityError');}});f.node.widgets.push({element:frame});assert.doesNotThrow(()=>f.extension.loadedGraphNode(f.node));f.type('blu');await wait(110);assert.ok(f.popup());f.node.onRemoved();
});

test('merged dictionary alone is the new tag default while saved choices win',async()=>{
  for(const saved of [undefined,[],['b.csv']]) {
    const f=await fixture({tagFiles:['tags_merged_dedup.csv','e621.csv','natural_language_tags.csv','All'],savedSettings:saved===undefined?{}:{'DanbooruTagJPAssist.TagFiles':saved}});
    f.type('blu');await wait(110);
    const params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
    assert.deepEqual(JSON.parse(params.get('tag_files')),saved??['tags_merged_dedup.csv']);
    f.node.onRemoved();
  }
});


test('all Settings labels, choices and help follow locale without changing stored values', async () => {
  const f = await fixture({savedSettings:{'Comfy.Locale':'ja','DanbooruTagJPAssist.CompletionBehavior':'csv','DanbooruTagJPAssist.AutoUpdateHf':true}});
  assert.equal(f.definitions.has('DanbooruTagJPAssist.AutoUpdateHf'), false);
  assert.equal(f.calls.some(c=>c.url.includes('hf-update')), false);
  const saved=JSON.stringify([...f.settings]);
  const behavior=f.definitions.get('DanbooruTagJPAssist.CompletionBehavior');
  assert.equal(behavior.name,'候補の挿入方法');
  assert.deepEqual(Array.from(behavior.options,o=>o.text), ['従来のタグ挿入','CSVごとの挿入方法']);
  assert.match(behavior.tooltip,/wordなら空白/);
  for (const definition of f.definitions.values()) {
    assert.match(definition.name,/[ぁ-んァ-ン一-龯]/,definition.id);
    assert.match(definition.tooltip,/[ぁ-んァ-ン一-龯]/,definition.id);
  }
  const list=f.mountFiles('Tag');
  assert.match(list.children[0].textContent,/上から順に優先/);
  const calls=f.calls.length;
  for (const lang of ['en','fr','zh','ko']) {
    f.settings.set('Comfy.Locale',lang);
    f.settingEvents.dispatchEvent(new Event('Comfy.Locale.change'));
    assert.equal(behavior.name,'Completion behavior');
    assert.equal(behavior.options[1].text,'CSV-aware');
    assert.match(behavior.tooltip,/word uses spaces/);
    assert.match(list.children[0].textContent,/First selected wins/);
    for(const def of f.definitions.values())assert.ok(def.tooltip.length>10,def.id);
  }
  f.settings.set('Comfy.Locale','ja-JP');
  f.settingEvents.dispatchEvent(new Event('Comfy.Locale.change'));
  assert.equal(behavior.name,'候補の挿入方法');
  assert.match(list.children[0].textContent,/上から順に優先/);
  assert.equal(f.calls.length,calls);
  f.settings.set('Comfy.Locale','ja');
  assert.equal(JSON.stringify([...f.settings]),saved);
  f.node.onRemoved();
});

test('usage ranking is opt-in and successful completions invalidate cached rankings',async()=>{
  const f=await fixture();
  assert.equal(f.definitions.get('DanbooruTagJPAssist.UsageRanking').defaultValue,false);
  f.type('blu');await wait(115);f.key('Enter');
  assert.equal(f.usageStorage.size,0);
  f.setting('UsageRanking',true);
  f.type('blu');await wait(115);f.key('Enter');
  assert.equal(JSON.parse(f.usageStorage.get(USAGE_STORAGE_KEY)).entries[0][1],1);
  f.type('blu');await wait(115);
  const last=f.calls.filter(c=>c.url.includes('/tags?')).at(-1);
  assert.equal(last.method,'POST');assert.deepEqual(JSON.parse(last.body).usage,[[candidateKey(item),1]]);
  f.key('Enter');
  assert.equal(JSON.parse(f.usageStorage.get(USAGE_STORAGE_KEY)).entries[0][1],2);
  f.setting('UsageRanking',false);f.type('blu');await wait(115);f.key('Enter');
  assert.equal(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).method,undefined);
  assert.equal(JSON.parse(f.usageStorage.get(USAGE_STORAGE_KEY)).entries[0][1],2);
  f.node.onRemoved();
});

test('search, Escape, stale selection, IME and unsuccessful edits do not count',async()=>{
  const f=await fixture({savedSettings:{'DanbooruTagJPAssist.UsageRanking':true}});
  f.type('blu');await wait(115);f.key('Escape');assert.equal(f.usageStorage.size,0);
  f.type('blu');await wait(115);f.area.setSelectionRange(1,1);f.key('Enter');assert.equal(f.usageStorage.size,0);
  f.type('blu');await wait(115);f.area.dispatchEvent(event('compositionstart'));f.key('Enter',{isComposing:true});
  assert.equal(f.usageStorage.size,0);f.area.dispatchEvent(event('compositionend'));f.area.dispatchEvent(event('keyup',{key:'Enter'}));
  f.type('blu');await wait(115);f.document.execCommand=()=>true;f.key('Enter');
  assert.equal(f.usageStorage.size,0);f.node.onRemoved();
});

test('mouse selection counts once, and clearing history dismisses cached suggestions',async()=>{
  const f=await fixture({savedSettings:{'DanbooruTagJPAssist.UsageRanking':true}});
  f.type('blu');await wait(115);
  const row=descendants(f.popup()).find(el=>el.style.cssText?.includes('cursor:pointer'));
  row.dispatchEvent(event('mousedown'));row.dispatchEvent(event('click'));
  assert.equal(JSON.parse(f.usageStorage.get(USAGE_STORAGE_KEY)).entries[0][1],1);
  f.type('blu');await wait(115);assert.ok(f.popup());
  const def=f.definitions.get('DanbooruTagJPAssist.ClearUsageHistory');
  const root=def.type();root.children[0].onclick();assert.equal(f.usageStorage.size,0);assert.equal(f.popup(),undefined);
  f.type('blu');await wait(115);assert.deepEqual(JSON.parse(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).body).usage,[]);
  f.node.onRemoved();
});

test('old servers retain normal completion and expose a usage-ranking notice',async()=>{
  const f=await fixture({usageRanking:false,savedSettings:{'DanbooruTagJPAssist.UsageRanking':true}});
  f.type('blu');await wait(115);assert.ok(f.popup());
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
  const root=f.definitions.get('DanbooruTagJPAssist.ClearUsageHistory').type();
  assert.match(root.children[1].textContent,/next restart/);f.node.onRemoved();
});

test('select all preserves priority, selections stay independent and clear stays empty',async()=>{
  const f=await fixture({savedSettings:{'DanbooruTagJPAssist.TagFiles':['b.csv']}});
  const tags=f.mountFiles('Tag');f.mountFiles('Translation');
  const click=text=>descendants(tags).find(el=>el.textContent===text).onclick();
  click('Select all');assert.deepEqual(Array.from(f.settings.get('DanbooruTagJPAssist.TagFiles')),['b.csv','a.csv']);
  click('Clear selection');assert.deepEqual(Array.from(f.settings.get('DanbooruTagJPAssist.TagFiles')),[]);
  f.type('blu');await wait(115);
  const params=new URL(f.calls.filter(c=>c.url.includes('/tags?')).at(-1).url,'http://local').searchParams;
  assert.equal(params.get('tag_files'),'[]');assert.equal(params.get('translation_files'),'["ja.csv","nl.csv"]');
  f.node.onRemoved();
});

test('legacy controls are collapsed, localized and preserve saved modes and choices',async()=>{
  const f=await fixture({savedSettings:{'Comfy.Locale':'ja','DanbooruTagJPAssist.TagSource':'own','DanbooruTagJPAssist.TagFile':'b.csv'}});
  for(const id of ['TagSource','TagFile','TranslationFile','TagSelectionMode','TranslationSelectionMode'])
    assert.equal(f.definitions.get(`DanbooruTagJPAssist.${id}`).type,'hidden');
  const root=f.definitions.get('DanbooruTagJPAssist.LegacyFiles').type();f.document.body.append(root);
  assert.equal(root.open,false);assert.match(root.children[0].textContent,/従来のCSV設定/);
  const source=()=>descendants(root).find(el=>el.attributes?.['aria-label']==='タグの取得元（従来モード）');
  assert.equal(source().disabled,true);assert.equal(source().value,'own');
  assert.deepEqual(source().children.map(el=>el.textContent),['保存済みのdanbooru_tags.csv','その他のローカルCSV','両方のローカルCSV']);
  const mode=descendants(root).find(el=>el.attributes?.['aria-label']==='タグCSVの選択方法');
  mode.value='legacy';await mode.onchange();assert.equal(source().disabled,false);assert.equal(source().value,'own');
  const list=f.mountFiles('Tag');assert.match(list.children[0].textContent,/従来モードを使用中/);
  await descendants(list).find(el=>el.textContent==='選択したCSVを使う').onclick();
  assert.equal(source().disabled,true);assert.equal(f.settings.get('DanbooruTagJPAssist.TagFile'),'b.csv');
  f.settings.set('Comfy.Locale','de');f.settingEvents.dispatchEvent(new Event('Comfy.Locale.change'));
  assert.match(root.children[0].textContent,/Legacy/);
  const labels=descendants(root).filter(el=>el.attributes?.['aria-label']).map(el=>el.attributes['aria-label']);
  assert.ok(labels.includes('Tag source (legacy mode)'));f.node.onRemoved();
});
