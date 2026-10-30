const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {entityRelationValues}=require('../.test-build/entity-database-relations.js');

test('entity relation values preserve distinct IDs and reject malformed, unsafe or oversized drafts',()=>{
  const field=randomUUID(),one=randomUUID(),two=randomUUID(), input={[field]:[one,two]};
  assert.deepEqual(entityRelationValues(input),input);
  assert.notEqual(entityRelationValues(input)[field],input[field]);
  for(const value of [{bad:[one]},{[field]:[one,one]},{[field]:['other/path']},{[field]:null},{[field]:Array.from({length:51},()=>randomUUID())}]) assert.throws(()=>entityRelationValues(value));
});
