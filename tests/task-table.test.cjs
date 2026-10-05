const {test}=require('node:test');
const assert=require('node:assert/strict');
const {taskColumns,taskCell,sortTableTasks}=require('../.test-build/task-table.js');
const members=[{id:'alice',displayName:'Alice',role:'member'}];
const properties=[
  {id:'priority',name:'Priority',type:'select',revision:1,options:[{id:'z',name:'Alpha'},{id:'a',name:'Zulu'}]},
  {id:'labels',name:'Labels',type:'multiSelect',revision:1,options:[{id:'one',name:'One'},{id:'two',name:'Two'}]},
  {id:'text',name:'Status',type:'text',revision:1,options:[]},
  {id:'date',name:'Release',type:'date',revision:1,options:[]},
];
const task=(id,patch={})=>({id,title:id,description:'',status:'todo',assigneeId:null,dueDate:null,position:0,...patch});
const ids=tasks=>tasks.map(task=>task.id);

test('table columns and display values retain stable field IDs, labels and multiline text',()=>{
  const columns=taskColumns(properties);assert.equal(columns.length,8);assert.equal(new Set(columns.map(column=>column.id)).size,8);
  assert.equal(columns[6].id,'property:text');assert.equal(columns[6].label,'Status');
  const row=task('a',{assigneeId:'alice',propertyValues:{priority:'z',labels:['two','one'],text:'<script>\nKeep source',date:'2026-10-04'}});
  assert.equal(taskCell(row,'assignee',properties,members),'Alice');assert.equal(taskCell(row,'property:priority',properties,members),'Alpha');
  assert.equal(taskCell(row,'property:labels',properties,members),'One, Two');assert.equal(taskCell(row,'property:text',properties,members),'<script>\nKeep source');
  assert.equal(taskCell(row,'property:date',properties,members),'2026-10-04');assert.equal(taskCell(row,'missing',properties,members),'');
  assert.equal(taskCell(task('b',{assigneeId:'former'}),'assignee',properties,members),'Unavailable member');
});
test('table sorts option labels rather than IDs, with empty values last in both directions',()=>{
  const rows=[task('a',{propertyValues:{priority:'a'}}),task('empty'),task('z',{propertyValues:{priority:'z'}})];
  const saved=structuredClone(rows);
  assert.deepEqual(ids(sortTableTasks(rows,{column:'property:priority',direction:'ascending'},properties,members)),['z','a','empty']);
  assert.deepEqual(ids(sortTableTasks(rows,{column:'property:priority',direction:'descending'},properties,members)),['a','z','empty']);
  assert.deepEqual(rows,saved);
  const renamed=properties.map(property=>property.id==='priority'?{...property,options:[{id:'z',name:'Zulu'},{id:'a',name:'Alpha'}]}:property);
  assert.deepEqual(ids(sortTableTasks(rows,{column:'property:priority',direction:'ascending'},renamed,members)),['a','z','empty']);
});
test('built-in sorting uses workflow order, natural titles, date-only values and stable ID ties',()=>{
  const rows=[task('z',{title:'Task 10',status:'done',dueDate:null}),task('b',{title:'Task 2',status:'doing',dueDate:'2026-11-01'}),task('a',{title:'Task 2',status:'todo',dueDate:'2026-10-04'})];
  assert.deepEqual(ids(sortTableTasks(rows,{column:'title',direction:'ascending'},properties,members)),['a','b','z']);
  assert.deepEqual(ids(sortTableTasks(rows,{column:'status',direction:'descending'},properties,members)),['z','b','a']);
  assert.deepEqual(ids(sortTableTasks(rows,{column:'dueDate',direction:'descending'},properties,members)),['b','a','z']);
});
test('default order, source updates and deletions reconcile without modifying or recreating rows',()=>{
  const rows=[task('b',{position:2}),task('a',{position:1}),task('c',{position:1})];
  assert.deepEqual(ids(sortTableTasks(rows,null,properties,members)),['a','c','b']);
  assert.deepEqual(ids(sortTableTasks(rows,{column:'property:removed',direction:'descending'},properties,members)),['a','c','b']);
  const next=rows.filter(row=>row.id!=='a').map(row=>row.id==='b'?{...row,title:'Alpha'}:row);
  assert.deepEqual(ids(sortTableTasks(next,{column:'title',direction:'ascending'},properties,members)),['b','c']);
  assert.equal(rows[0].title,'b');assert.equal(rows.length,3);
});
