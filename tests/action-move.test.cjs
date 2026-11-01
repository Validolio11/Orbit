const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateState } = require('../src/core.cjs');

const action=(id,kind='app',children=[])=>({id,name:id,kind,target:kind==='group'?'':`C:\\Apps\\${id}.exe`,args:'"C:\\Project files\\scene.aep" --profile=work',icon:kind==='group'?'group':'app',children});
const group=(id,children=[])=>action(id,'group',children);
const configuration=items=>validateState({version:1,theme:'dark',enabled:true,reducedMotion:false,triggerButton:4,activationMode:'hover',hoverDelay:350,activeMenuId:'main',menus:[{id:'main',name:'Main',icon:'orbit',items}]});

test('moving a list action into Adobe appends it and preserves all launch metadata',async()=>{
  const {moveActionToGroup}=await import('../src/renderer/action-move.mjs');
  const original=configuration([action('illustrator'),group('adobe',[action('photoshop')]),action('browser')]);
  const snapshot=structuredClone(original);
  const moved=moveActionToGroup(original,'illustrator','adobe');
  assert.deepEqual(original,snapshot);
  assert.deepEqual(moved.menus[0].items.map(item=>item.id),['adobe','browser']);
  assert.deepEqual(moved.menus[0].items[0].children,[snapshot.menus[0].items[1].children[0],snapshot.menus[0].items[0]]);
  assert.notEqual(moved,original);
  assert.deepEqual(validateState(moved),moved);
});

test('moving a nested group across menus preserves its subtree, IDs and sibling order',async()=>{
  const {moveActionToGroup}=await import('../src/renderer/action-move.mjs');
  const subtree=group('tools',[action('render'),group('extras',[action('editor')])]);
  const original=configuration([action('before'),subtree,action('after')]);
  original.menus.push({id:'second',name:'Second',icon:'orbit',items:[group('target',[action('existing')])]});
  validateState(original);
  const snapshot=structuredClone(original),moved=moveActionToGroup(original,'tools','target');
  assert.deepEqual(original,snapshot);
  assert.deepEqual(moved.menus[0].items.map(item=>item.id),['before','after']);
  assert.deepEqual(moved.menus[1].items[0].children.map(item=>item.id),['existing','tools']);
  assert.deepEqual(moved.menus[1].items[0].children[1],subtree);
  assert.deepEqual(validateState(moved),moved);
});

test('same-parent drops are cloned no-ops even when the group is full',async()=>{
  const {moveActionToGroup}=await import('../src/renderer/action-move.mjs');
  const original=configuration([group('adobe',Array.from({length:12},(_,index)=>action(`app-${index}`)))]);
  const moved=moveActionToGroup(original,'app-4','adobe');
  assert.notEqual(moved,original);
  assert.deepEqual(moved,original);
});

test('invalid targets, self moves, descendant cycles and full groups leave the original intact',async()=>{
  const {moveActionToGroup}=await import('../src/renderer/action-move.mjs');
  const original=configuration([group('adobe',[group('nested',[group('deep')])]),action('app'),group('full',Array.from({length:12},(_,index)=>action(`app-${index}`)))]);
  const snapshot=structuredClone(original);
  for(const [source,target,message]of [['missing','adobe',/Дію/],['app','missing',/Групу/],['adobe','app',/лише в групу/],['adobe','adobe',/саму себе/],['adobe','deep',/власну вкладену/],['app','full',/12 дій/]]){
    assert.throws(()=>moveActionToGroup(original,source,target),message);
    assert.deepEqual(original,snapshot);
  }
});

test('depth checks account for the whole moved subtree and allow a leaf at depth four',async()=>{
  const {moveActionToGroup}=await import('../src/renderer/action-move.mjs');
  const original=configuration([group('root',[group('level1',[group('level2',[group('level3')])])]),action('leaf'),group('branch',[action('child')])]);
  const snapshot=structuredClone(original);
  const allowed=moveActionToGroup(original,'leaf','level3');
  assert.deepEqual(validateState(allowed),allowed);
  assert.equal(allowed.menus[0].items[0].children[0].children[0].children[0].children[0].id,'leaf');
  assert.throws(()=>moveActionToGroup(original,'branch','level3'),/чотири вкладені/);
  assert.deepEqual(original,snapshot);
});

test('dragover validation allocates no state clone and agrees with drop validation',async()=>{
  const {actionMoveError,moveActionToGroup}=await import('../src/renderer/action-move.mjs');
  const original=configuration([action('app'),group('adobe',[group('nested')])]);
  const freeze=value=>{Object.freeze(value);for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);};
  freeze(original);
  assert.equal(actionMoveError(original,'app','adobe'),null);
  for(const [source,target]of [['missing','adobe'],['adobe','missing'],['adobe','app'],['adobe','adobe'],['adobe','nested']]){
    const message=actionMoveError(original,source,target);
    assert.equal(typeof message,'string');
    assert.throws(()=>moveActionToGroup(original,source,target),error=>error.message===message);
  }
  assert.equal(actionMoveError(original,'nested','adobe'),null);
  assert.deepEqual(validateState(moveActionToGroup(original,'app','adobe')).menus[0].items[0].children.map(item=>item.id),['nested','app']);
});
