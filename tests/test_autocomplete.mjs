import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../web/lib/completion_core.js';

class Element extends EventTarget {
  constructor() {super();this.style={display:'none'};this.children=[];this.isConnected=true;this.value='';this.attributes={};}
  setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name]??null;}
  append(...els){this.children.push(...els);}
  appendChild(el){this.append(el);return el;}
  replaceChildren(){this.children=[];}
  contains(el){return this===el || this.children.some(child=>child.contains?.(el));}
  remove(){this.isConnected=false;}
  closest(){return null;}
  querySelectorAll(){return [];}
  querySelector(){return null;}
  getBoundingClientRect(){return {left:10,bottom:100,width:500};}
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

async function fixture({delay=0,orderedSelection=true,savedSort,savedSettings={},fileListFailsOnce=false,suggestions=[item]}={}) {
  const window=Object.assign(new EventTarget(),{innerWidth:1000,innerHeight:800});
  const document = new Element();
  document.body=new Element();
  document.createElement=()=>new Element();
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
  const app={ui:{settings:{addSetting(def){definitions.set(def.id,def);if(typeof def.type!=='function' && !settings.has(def.id)) settings.set(def.id,def.defaultValue);},getSettingValue(id){return settings.get(id);}}},registerExtension(ext){extension=ext;}};
  const fetch=async (url,options)=>{
    calls.push({url,signal:options.signal});
    if(url.includes('/files')) {
      if(fileListFailsOnce) {fileListFailsOnce=false;throw new Error('file list temporarily unavailable');}
      return {ok:true,json:async()=>({tag_files:['a.csv','b.csv','All'],translation_files:['ja.csv','nl.csv','All'],ordered_selection:orderedSelection})};
    }
    if(url.includes('/revision'))return {ok:true,json:async()=>({revision,ordered_selection:orderedSelection})};
    if(url.includes('/hf-update'))return {ok:true,json:async()=>({updated:false})};
    if(delay)await wait(delay); // Deliberately ignore AbortSignal to model an already queued response.
    if(fail)throw new Error('offline');
    return {ok:true,json:async()=>({tags:suggestions,revision})};
  };
  const context=vm.createContext({app,core,positionPopup:()=>{},document,Element,HTMLTextAreaElement:Textarea,AbortController,Event,InputEvent:Event,URLSearchParams,Map,Set,WeakMap,WeakSet,console,fetch,setTimeout,clearTimeout,window,requestAnimationFrame:fn=>setTimeout(fn,0),MutationObserver:class{constructor(callback){observerCallback=callback;}observe(){}}});
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
  return {window,document,node,area,popup,type,key,setting,calls,extension,setRevision:v=>revision=v,offline:()=>fail=true,definitions,mountFiles,settings,
    notifyMutation:(addedNodes)=>observerCallback?.([{addedNodes}])};
}

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

test('word unit changes invalidate pending searches and keep tag unit as the default',async()=>{
  const f=await fixture({delay:50});
  assert.equal(f.definitions.get('DanbooruTagJPAssist.CompletionUnit').defaultValue,'tag');
  f.type('with pokeball b');await wait(95);f.setting('CompletionUnit','word');await wait(70);
  assert.equal(f.popup(),undefined);f.type('with pokeball b');await wait(160);
  assert.ok(f.popup());assert.equal(f.key('Enter').defaultPrevented,true);
  assert.equal(f.area.value,'with pokeball blue, ');f.node.onRemoved();
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
