const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { propertyDefinition, validatePropertyChange, validatePropertyValues, changedPropertyValues, propertyDisplay } = require('../.test-build/board-properties.js');

test('custom fields validate types, bounded unique option identities and names', () => {
  const option = { id: randomUUID(), name: 'High' };
  assert.deepEqual(propertyDefinition({name:' Priority ',type:'select',options:[option]}), {name:'Priority',type:'select',options:[option]});
  for(const input of [
    {name:'',type:'text',options:[]}, {name:'X',type:'unknown',options:[]},
    {name:'X',type:'text',options:[option]}, {name:'X',type:'select',options:[option,option]},
    {name:'X',type:'select',options:[option,{id:randomUUID(),name:'HIGH'}]},
    {name:'X',type:'select',options:[{id:'__proto__',name:'Bad'}]},
    {name:'X',type:'text',options:[],foreign:true},
  ]) assert.throws(()=>propertyDefinition(input));
});
test('property renames preserve identity and reject stale versions, type changes, removed options and caps', () => {
  const id=randomUUID(), option={id:randomUUID(),name:'High'};
  const original={id,name:'Priority',type:'select',options:[option],revision:1};
  const next=validatePropertyChange([original],id,1,{name:'Urgency',type:'select',options:[{...option,name:'Critical'}]});
  assert.equal(next.revision,2); assert.equal(next.options[0].id,option.id);
  assert.throws(()=>validatePropertyChange([next],id,1,next));
  assert.throws(()=>validatePropertyChange([original],id,1,{name:'Priority',type:'text',options:[]}));
  assert.throws(()=>validatePropertyChange([original],id,1,{name:'Priority',type:'select',options:[]}));
  assert.throws(()=>validatePropertyChange([original],randomUUID(),0,{name:'PRIORITY',type:'text',options:[]}));
  assert.throws(()=>validatePropertyChange(Array.from({length:32},(_,i)=>({...original,id:randomUUID(),name:`Field ${i}`})),randomUUID(),0,{name:'Extra',type:'text',options:[]}));
});
test('field values reject foreign options, duplicate multi-selects, impossible dates and unbounded text',()=>{
  const option={id:randomUUID(),name:'Release'}, properties=['text','select','multiSelect','date'].map(type=>({id:randomUUID(),name:type,type,options:type.includes('elect')?[option]:[],revision:1}));
  const [text,select,multi,date]=properties;
  const valid={[text.id]:'Hello',[select.id]:option.id,[multi.id]:[option.id],[date.id]:'2028-02-29'};
  assert.deepEqual(validatePropertyValues(valid,properties),valid);
  for(const value of [
    {[randomUUID()]:'foreign'}, {[select.id]:randomUUID()}, {[multi.id]:[option.id,option.id]},
    {[multi.id]:option.id}, {[date.id]:'2026-02-29'}, {[date.id]:'2026-10-04T12:00:00Z'},
    {[date.id]:'0000-01-01'}, {[text.id]:'x'.repeat(2001)}, {__proto__:null, bad:'x'}, {[text.id]:{script:'x'}},
  ]) assert.throws(()=>validatePropertyValues(value,properties));
  assert.deepEqual(validatePropertyValues({[date.id]:null,[multi.id]:[]},properties),{[date.id]:null,[multi.id]:[]});
});
test('selective field patches preserve unrelated changes and option renames display existing selections',()=>{
  const one=randomUUID(),two=randomUUID(),option={id:randomUUID(),name:'Renamed'};
  assert.deepEqual(changedPropertyValues({[one]:'old',[two]:'keep'},{[one]:null,[two]:'keep'}),{[one]:null});
  assert.deepEqual(changedPropertyValues({}, {[one]:null}),{});
  assert.equal(propertyDisplay({id:one,name:'Labels',type:'multiSelect',options:[option],revision:2},[option.id]),'Renamed');
});

test('ten field types validate exact scalar shapes, safe URLs, scopes and archived option retention',()=>{
  const types=['text','longText','number','date','checkbox','select','multiSelect','person','relation','url'];
  const option={id:randomUUID(),name:'Archived',color:'purple',archived:true};
  const properties=types.map(type=>({id:randomUUID(),revision:1,...propertyDefinition({name:type,type,options:type.includes('elect')?[option]:[],projectId:'project'})}));
  const ids=Object.fromEntries(properties.map(property=>[property.type,property.id]));
  const values={text:'text',longText:'x'.repeat(10000),number:-0.25,date:'2028-02-29',checkbox:false,select:option.id,multiSelect:[option.id],person:'person',relation:'project',url:'https://example.test/'};
  const packet=Object.fromEntries(types.map(type=>[ids[type],values[type]]));
  assert.deepEqual(validatePropertyValues(packet,properties,packet),packet);
  assert.throws(()=>validatePropertyValues(packet,properties));
  for(const [type,invalid]of [['number','1'],['number',Infinity],['checkbox','false'],['checkbox',0],['url','javascript:alert(1)'],['url','https://user:password@example.test'],['person','../../x'],['relation',[]],['longText','x'.repeat(10001)]])assert.throws(()=>validatePropertyValues({[ids[type]]:invalid},properties));
  assert.equal(propertyDisplay(properties.find(p=>p.type==='checkbox'),false),'No');
  assert.equal(propertyDisplay(properties.find(p=>p.type==='number'),0),'0');
  assert.equal(propertyDisplay(properties.find(p=>p.type==='person'),'person',[{id:'person',displayName:'Alice'}]),'Alice');
  assert.equal(propertyDisplay(properties.find(p=>p.type==='relation'),'project',[],[{id:'project',name:'Release'}]),'Release');
  const scoped=properties[0];
  assert.throws(()=>validatePropertyChange([scoped],scoped.id,1,{...scoped,projectId:null}));
  assert.doesNotThrow(()=>validatePropertyChange([scoped],randomUUID(),0,{name:scoped.name,type:'text',options:[],projectId:'other'}));
});
