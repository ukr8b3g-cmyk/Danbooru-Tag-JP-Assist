import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatPrompt, formatSelection, replacementEdit} from '../web/lib/prompt_format.js';
import {applyFormat, isPromptController, installFormatting, mountFormatButton} from '../web/lib/format_ui.js';

test('normalize separators while preserving paragraphs and indentation',()=>{
  assert.equal(formatPrompt('  1girl,,  solo , smile\r\n\r\n\tblue hair,  sky'), '  1girl, solo, smile\r\n\r\n\tblue hair, sky');
});
test('syntax groups, escapes, wildcards, model references and artist tags stay intact',()=>{
  const tokens=['(blue_hair,  smile:1.2)','[a_b:c_d:0.5]','{red_hair|blue_hair}','<lora:some_model:1>','__my_wildcard__','@some_artist','embedding:some_name','character \\(series_name\\)','"a,  b"',':3','> <'];
  assert.equal(formatPrompt(tokens.join(',,  '),{underscores:true,duplicates:true}),tokens.join(', '));
});
test('underscore exclusions and score tags are protected',()=>{
  assert.equal(formatPrompt('blue_hair, score_9, keep_me',{underscores:true,exclusions:'keep_*'}),'blue hair, score_9, keep_me');
});
test('deduplicate only plain tags within each line',()=>{
  assert.equal(formatPrompt('smile, (smile), smile, (smile)\nsmile, smile',{duplicates:true}),'smile, (smile), (smile)\nsmile');
  assert.equal(formatPrompt('BREAK, BREAK, AND, AND',{duplicates:true}),'BREAK, BREAK, AND, AND');
});
test('no deduplication or underscore conversion by default',()=>{
  assert.equal(formatPrompt('blue_hair,blue_hair'),'blue_hair, blue_hair');
});
test('newline comma excludes control lines, sentences and network-only lines',()=>{
  assert.equal(formatPrompt('1girl\n\nBREAK\n<lora:a:1>\nA girl smiles.\nsolo',{appendComma:true}), '1girl,\n\nBREAK\n<lora:a:1>\nA girl smiles.\nsolo');
});
test('preserve JSON, code, malformed and multiline protected syntax',()=>{
  for(const text of ['{"x": [1,  2]}','```json\n{ }\n```','(smile,  solo','[a,\n  b]']) assert.equal(formatPrompt(text,{underscores:true}),text);
});
test('keep apostrophes, numeric separators and escaped commas',()=>{
  assert.equal(formatPrompt("don't,  1,000, a\\,b"),"don't, 1,000, a\\,b");
});
test('formatting is idempotent',()=>{
  for(const text of ['a,,b\n\nc', 'a,a,(a),score_9,__x__', '  a, \r\n b']) {
    const options={underscores:true,duplicates:true,appendComma:true};
    assert.equal(formatPrompt(formatPrompt(text,options),options),formatPrompt(text,options));
  }
});
test('partial selection cannot alter a protected syntax token',()=>{
  for (const text of ['(blue_hair:1.2)','<lora:blue_hair:1>','__blue_hair__','@blue_hair','embedding:blue_hair']) {
    const start=text.indexOf('blue_hair');
    assert.equal(formatSelection(text,start,start+9,{underscores:true}),text);
  }
  assert.equal(formatSelection('prefix a,,  b suffix',7,13,{}),'prefix a, b suffix');
});
test('bulk recognition excludes notes and code nodes',()=>{
  const textarea={};
  const c=type=>({textarea,node:{type,widgets:[{name:'text',inputEl:textarea}]}});
  assert.equal(isPromptController(c('CLIPTextEncode')),true);
  assert.equal(isPromptController(c('PrimitiveStringMultiline')),true);
  assert.equal(isPromptController(c('JSONTextInput')),false);
  assert.equal(isPromptController(c('Note')),false);
  assert.equal(isPromptController(c('UnknownNode')),false);
});
test('custom prompt fields opt into batch formatting; literal wording requires explicit current input',()=>{
  const handlers=new Map(),values=new Map();
  const area=marker=>({value:'blue,,  sky',dataset:{jpAssistFormat:marker},isConnected:true,selectionStart:11,selectionEnd:11,
    focus(){document.activeElement=this;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},dispatchEvent(){}});
  const prompt=area('prompt'),literal=area('literal'),extra=area(undefined),other=area('prompt');
  const node={type:'MOSSSharedPrompter',widgets:[{name:'krea2_prompt_ui',element:{contains:()=>true}}]};
  const controllers=[prompt,literal,extra].map(textarea=>({textarea,node}));
  controllers.push({textarea:other,node:{type:'MOSSSharedPrompter'}});
  globalThis.document={activeElement:prompt,body:{},querySelector(){return null;},createElement(){return new ButtonElement();},addEventListener(name,fn){handlers.set(name,fn);},
    execCommand(_cmd,_ui,text){const el=this.activeElement;el.value=el.value.slice(0,el.selectionStart)+text+el.value.slice(el.selectionEnd);return true;}};
  globalThis.MutationObserver=class{observe(){}};globalThis.window={addEventListener(){}};
  const app={canvas:{selected_nodes:{one:node}},ui:{settings:{addSetting(){},getSettingValue:id=>values.get(id)}}};
  try {
    const {run}=installFormatting(app,{getControllers:()=>controllers,begin(){},end(){}});
    assert.equal(run(),2);assert.equal(prompt.value,'blue, sky');assert.equal(literal.value,'blue,,  sky');assert.equal(extra.value,'blue,,  sky');
    prompt.value=other.value='red,,  sky';values.set('DanbooruTagJPAssist.FormatScope','selected');
    assert.equal(run(),1);assert.equal(prompt.value,'red, sky');assert.equal(other.value,'red,,  sky');
    values.set('DanbooruTagJPAssist.FormatScope','current');
    document.activeElement=literal;handlers.get('focusin')({target:literal});
    document.activeElement={};assert.equal(run(),1);assert.equal(literal.value,'blue, sky');assert.equal(document.activeElement,literal);
    assert.equal(isPromptController({textarea:area('prompt'),node:{type:'Note'}}),false);
  } finally {delete globalThis.document;delete globalThis.MutationObserver;delete globalThis.window;}
});
test('minimal replacement maps positions before and after the edit',()=>{
  const edit=replacementEdit('a,,  b','a, b');
  assert.equal('a,,  b'.slice(0,edit.start)+edit.replacement+'a,,  b'.slice(edit.end),'a, b');
  assert.equal(edit.map(0),0);assert.equal(edit.map(6),4);
});
test('selected-range edit uses native input and keeps surrounding text and scroll',()=>{
  const events=[];
  const area={value:'prefix a,,  b suffix',selectionStart:7,selectionEnd:13,selectionDirection:'forward',scrollTop:22,scrollLeft:3,
    focus(){document.activeElement=this;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},dispatchEvent(e){events.push(e.type);}};
  globalThis.document={execCommand(cmd,_ui,text){assert.ok(['insertText','delete'].includes(cmd));area.value=area.value.slice(0,area.selectionStart)+text+area.value.slice(area.selectionEnd);events.push('input');return true;}};
  assert.equal(applyFormat(area,{},true),true);
  assert.equal(area.value,'prefix a, b suffix');
  assert.equal(area.scrollTop,22);assert.equal(area.scrollLeft,3);
  assert.deepEqual(events,['input','change']);
  delete globalThis.document;
});
test('unchanged input creates no edit or focus change',()=>{
  const area={value:'a, b',selectionStart:4,selectionEnd:4,focus(){throw Error('unexpected focus');}};
  assert.equal(applyFormat(area,{}),false);
});
test('unsupported native editing preserves text and selection',()=>{
  const area={value:'a,, b',selectionStart:5,selectionEnd:5,focus(){document.activeElement=this;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}};
  globalThis.document={execCommand(){return false;}};
  try {
    assert.throws(()=>applyFormat(area,{}),/undoable/);
    assert.equal(area.value,'a,, b');assert.equal(area.selectionStart,5);assert.equal(area.selectionEnd,5);
  } finally {delete globalThis.document;}
});

test('a field that cannot take focus never edits the previously focused prompt',()=>{
  const visible={value:'my actual prompt'},hidden={value:'old,hidden,phrase',selectionStart:0,selectionEnd:0,focus(){},setSelectionRange(){throw Error('hidden selection must not change');}};
  globalThis.document={activeElement:visible,execCommand(){throw Error('must not edit the visible prompt');}};
  try{assert.equal(applyFormat(hidden,{}),false);assert.equal(visible.value,'my actual prompt');assert.equal(hidden.value,'old,hidden,phrase');}
  finally{delete globalThis.document;}
});

test('formatting uses the input owner document for iframe editing',()=>{
  const events=[],doc={execCommand(_cmd,_ui,text){const el=this.activeElement;el.value=el.value.slice(0,el.selectionStart)+text+el.value.slice(el.selectionEnd);return true;}};
  const area={ownerDocument:doc,value:'a,, b',selectionStart:5,selectionEnd:5,focus(){doc.activeElement=this;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},dispatchEvent(e){events.push(e.type);}};
  globalThis.document={execCommand(){throw Error('wrong document');}};
  try{assert.equal(applyFormat(area,{}),true);assert.equal(area.value,'a, b');assert.deepEqual(events,['change']);}
  finally{delete globalThis.document;}
});

test('formatter blocks IME and stale inputs, honors scope, and registers Settings',()=>{
  const handlers=new Map(), definitions=new Map(), values=new Map();
  const area=()=>({value:'a,, b',isConnected:true,selectionStart:5,selectionEnd:5,
    focus(){document.activeElement=this;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},dispatchEvent(){}});
  const first=area(), second=area(), note=area();
  const controllers=[first,second,note].map((textarea,i)=>({textarea,node:{type:i===2?'Note':'CLIPTextEncode',widgets:[{name:'text',inputEl:textarea}]}}));
  const doc={activeElement:first,body:{},querySelector(){return null;},createElement(){return new ButtonElement();},addEventListener(name,fn){handlers.set(name,fn);},
    execCommand(_cmd,_ui,text){const a=this.activeElement;a.value=a.value.slice(0,a.selectionStart)+text+a.value.slice(a.selectionEnd);return true;}};
  globalThis.document=doc;
  globalThis.MutationObserver=class{observe(){}};
  globalThis.window={addEventListener(){}};
  const app={canvas:{selected_nodes:{one:controllers[0].node,note:controllers[2].node}},ui:{settings:{
    addSetting(d){definitions.set(d.id,d);},getSettingValue(id){return values.get(id);}}}};
  let begun=0,ended=0;
  try {
    const {run}=installFormatting(app,{getControllers:()=>controllers,begin:()=>begun++,end:()=>ended++});
    assert.equal(definitions.size,5);
    assert.equal(definitions.get('DanbooruTagJPAssist.FormatScope').defaultValue,'all');
    values.set('Comfy.Locale','ja');
    const settingsButton=definitions.get('DanbooruTagJPAssist.FormatNow').type();
    assert.match(settingsButton.title,/プロンプトのカンマ・空白/);
    values.set('Comfy.Locale','fr');settingsButton.dispatchEvent(new Event('mouseenter'));
    assert.match(settingsButton.title,/Clean up prompt commas and spacing/);
    for(const d of definitions.values())assert.equal(d.category[0],'Danbooru Tag JP Assist');
    for(const key of ['Duplicates','Underscores','AppendComma'])assert.equal(definitions.get('DanbooruTagJPAssist.Format'+key).defaultValue,false);
    handlers.get('focusin')({target:first});handlers.get('compositionstart')({target:first});
    assert.equal(run(),0);assert.equal(first.value,'a,, b');
    handlers.get('compositionend')({target:first});
    assert.equal(run(),2);assert.equal(note.value,'a,, b');
    first.value='a,, b';second.value='a,, b';
    values.set('DanbooruTagJPAssist.FormatScope','selected');
    assert.equal(run(),1);assert.equal(second.value,'a,, b');assert.equal(note.value,'a,, b');
    values.set('DanbooruTagJPAssist.FormatScope','all');second.readOnly=true;
    assert.equal(run(),0);second.readOnly=false;second.isConnected=false;assert.equal(run(),0);
    second.isConnected=true;assert.equal(run(),1);assert.equal(second.value,'a, b');
    assert.equal(note.value,'a,, b');assert.equal(document.activeElement,first);assert.equal(begun,ended);
  } finally {delete globalThis.document;delete globalThis.MutationObserver;delete globalThis.window;}
});

class ButtonElement extends EventTarget {
  constructor(visible=true){super();this.style={};this.children=[];this.isConnected=true;this.visible=visible;}
  setAttribute(){}
  getClientRects(){return this.visible && this.isConnected ? [{}] : [];}
  appendChild(el){
    if(el.parentElement)el.parentElement.children=el.parentElement.children.filter(child=>child!==el);
    this.children.push(el);el.parentElement=this;el.isConnected=this.isConnected;
  }
  after(el){this.parentElement.appendChild(el);el.previousElementSibling=this;}
}

test('own public text node participates in all and selected formatting with exclusions intact', () => {
  const publicId = readFileSync(new URL('../__init__.py', import.meta.url), 'utf8')
    .match(/["']([^"']+)["']\s*:\s*DanbooruTagJPAssist\s*[,}]/)[1];
  const handlers = new Map(), values = new Map();
  const area = () => ({value:'blue,,  sky',isConnected:true,selectionStart:11,selectionEnd:11,
    focus(){document.activeElement=this;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},dispatchEvent(){}});
  const first=area(), second=area(), note=area(), json=area();
  const controllers=[first,second,note,json].map((textarea,i)=>({textarea,
    node:{comfyClass:i<2?publicId:i===2?'Note':'JSON',widgets:[{name:'text',inputEl:textarea}]}}));
  const doc={activeElement:first,body:{},querySelector(){return null;},createElement(){return new ButtonElement();},
    addEventListener(name,fn){handlers.set(name,fn);},execCommand(_cmd,_ui,text){const a=this.activeElement;a.value=a.value.slice(0,a.selectionStart)+text+a.value.slice(a.selectionEnd);return true;}};
  globalThis.document=doc;globalThis.MutationObserver=class{observe(){}};globalThis.window={addEventListener(){}};
  const app={canvas:{selected_nodes:{one:controllers[0].node}},ui:{settings:{addSetting(){},getSettingValue:id=>values.get(id)}}};
  try {
    const {run}=installFormatting(app,{getControllers:()=>controllers,begin(){},end(){}});
    assert.equal(run(),2);assert.equal(first.value,'blue, sky');assert.equal(second.value,'blue, sky');
    first.value=second.value='blue,,  sky';values.set('DanbooruTagJPAssist.FormatScope','selected');
    assert.equal(run(),1);assert.equal(first.value,'blue, sky');assert.equal(second.value,'blue,,  sky');
    first.value='blue,,  sky';first.readOnly=true;assert.equal(run(),0);first.readOnly=false;
    first.disabled=true;assert.equal(run(),0);first.disabled=false;
    handlers.get('compositionstart')({target:first});assert.equal(run(),0);handlers.get('compositionend')({target:first});
    assert.equal(run(),1);assert.equal(note.value,'blue,,  sky');assert.equal(json.value,'blue,,  sky');
    assert.equal(isPromptController({node:{type:publicId,widgets:[{name:'code',inputEl:first}]},textarea:first}),false);
  } finally {for(const key of ['document','MutationObserver','window'])delete globalThis[key];}
});
test('toolbar waits past hidden legacy menu and survives delayed/replaced modern toolbar',()=>{
  const legacy=new ButtonElement(false);
  let modern=null, mutation, frame;
  const root=new ButtonElement();
  globalThis.document={body:root,createElement(){return new ButtonElement();},querySelector(selector){return selector==='.comfy-menu'?legacy:modern;}};
  globalThis.MutationObserver=class{constructor(fn){mutation=fn;}observe(){}};
  globalThis.requestAnimationFrame=fn=>{frame=fn;return 1;};
  globalThis.window={addEventListener(){}};
  try {
    let clicks=0;
    let locale='ja';
    const button=mountFormatButton({ui:{settings:{getSettingValue:()=>locale}}},()=>clicks++);
    const japanese='プロンプトのカンマ・空白を整えます。対象・追加処理は設定に従います。';
    const english='Clean up prompt commas and spacing, using the configured target and options.';
    assert.equal(button.title,japanese);
    for(const lang of ['en','zh','fr','ko','']) {
      locale=lang;button.dispatchEvent(new Event('mouseenter'));assert.equal(button.title,english);
    }
    locale='ja-JP';button.dispatchEvent(new Event('focus'));assert.equal(button.title,japanese);
    assert.equal(legacy.children.length,0);
    modern=new ButtonElement();root.appendChild(modern);mutation();frame();
    assert.equal(button.parentElement,modern);assert.equal(modern.children.length,1);
    button.dispatchEvent(new Event('click'));assert.equal(clicks,1);
    const mouse=new Event('mousedown',{cancelable:true});button.dispatchEvent(mouse);assert.equal(mouse.defaultPrevented,true);
    button.isConnected=false;modern=new ButtonElement();root.appendChild(modern);mutation();frame();
    assert.equal(button.parentElement,modern);assert.equal(modern.children.length,1);
    mutation();frame();assert.equal(modern.children.length,1);
    button.dispatchEvent(new Event('click'));assert.equal(clicks,2);
    assert.ok(!button.className.includes('mobile-collapse'));
  } finally {for(const key of ['document','MutationObserver','requestAnimationFrame','window'])delete globalThis[key];}
});
test('visible classic action group remains supported',()=>{
  const parent=new ButtonElement(),actions=new ButtonElement();parent.appendChild(actions);
  globalThis.document={body:parent,createElement(){return new ButtonElement();},querySelector(){return null;}};
  globalThis.MutationObserver=class{observe(){}};globalThis.window={addEventListener(){}};
  try {assert.equal(mountFormatButton({menu:{actionsGroup:{element:actions}}},()=>{}).previousElementSibling,actions);}
  finally {for(const key of ['document','MutationObserver','window'])delete globalThis[key];}
});


test('format Settings and toolbar update Japanese help on locale changes', () => {
  const events = new EventTarget(), definitions = new Map();
  let locale='ja';
  globalThis.document={body:{},createElement(){return new ButtonElement();},querySelector(){return null;},addEventListener(){}};
  globalThis.MutationObserver=class{observe(){}};globalThis.window={addEventListener(){}};
  const app={ui:{settings:Object.assign(events,{getSettingValue:id=>id==='Comfy.Locale'?locale:undefined,addSetting:def=>definitions.set(def.id,def)})}};
  try {
    installFormatting(app,{getControllers:()=>[],begin(){},end(){}});
    assert.equal(definitions.size,5);
    for(const def of definitions.values()) {
      assert.match(def.name,/[ぁ-んァ-ン一-龯]/,def.id);
      assert.match(def.tooltip,/[ぁ-んァ-ン一-龯]/,def.id);
    }
    const format=definitions.get('DanbooruTagJPAssist.FormatNow').type();
    assert.equal(format.textContent,'整形');
    const scope=definitions.get('DanbooruTagJPAssist.FormatScope');
    const originalValues=scope.options.map(o=>o.value);
    locale='en';events.dispatchEvent(new Event('Comfy.Locale.change'));
    assert.equal(format.textContent,'Format');
    assert.equal(scope.name,'Format target');assert.match(scope.tooltip,/All:/);
    assert.deepEqual(scope.options.map(o=>o.value),originalValues);
    locale='ja';events.dispatchEvent(new Event('Comfy.Locale.change'));
    assert.equal(format.textContent,'整形');assert.equal(scope.name,'整形する対象');
    assert.match(scope.options[2].text,/すべて/);
  } finally {for(const key of ['document','MutationObserver','window'])delete globalThis[key];}
});
