const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { propertyDefinition, validatePropertyChange, validatePropertyValues, changedPropertyValues, propertyDisplay } = require('../.test-build/board-properties.js');

test('custom fields validate types, bounded unique option identities and names', () => {
  const option = { id: randomUUID(), name: 'High' };
  assert.deepEqual(propertyDefinition({name:' Priority ',type:'select',options:[option]}), {name:'Priority',type:'select',options:[option]});
  for(const input of [
    {name:'',type:'text',options:[]}, {name:'X',type:'number',options:[]},
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
    {[text.id]:'x'.repeat(2001)}, {__proto__:null, bad:'x'}, {[text.id]:{script:'x'}},
  ]) assert.throws(()=>validatePropertyValues(value,properties));
  assert.deepEqual(validatePropertyValues({[date.id]:null,[multi.id]:[]},properties),{[date.id]:null,[multi.id]:[]});
});
test('selective field patches preserve unrelated changes and option renames display existing selections',()=>{
  const one=randomUUID(),two=randomUUID(),option={id:randomUUID(),name:'Renamed'};
  assert.deepEqual(changedPropertyValues({[one]:'old',[two]:'keep'},{[one]:null,[two]:'keep'}),{[one]:null});
  assert.deepEqual(changedPropertyValues({}, {[one]:null}),{});
  assert.equal(propertyDisplay({id:one,name:'Labels',type:'multiSelect',options:[option],revision:2},[option.id]),'Renamed');
});
