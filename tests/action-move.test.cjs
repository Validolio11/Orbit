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

test('a nested action moves to its containing menu root and preserves metadata and sibling order',async()=>{
  const {moveActionToRoot}=await import('../src/renderer/action-move.mjs');
  const original=configuration([action('first'),group('adobe',[action('before'),action('illustrator'),action('after')]),action('last')]);
  const snapshot=structuredClone(original),moved=moveActionToRoot(original,'illustrator');
  assert.deepEqual(original,snapshot);
  assert.deepEqual(moved.menus[0].items.map(item=>item.id),['first','adobe','last','illustrator']);
  assert.deepEqual(moved.menus[0].items[1].children.map(item=>item.id),['before','after']);
  assert.deepEqual(moved.menus[0].items.at(-1),snapshot.menus[0].items[1].children[1]);
  assert.deepEqual(validateState(moved),moved);
});

test('deeply nested folders and groups move to root without losing paths or descendants',async()=>{
  const {moveActionToRoot}=await import('../src/renderer/action-move.mjs');
  const folder={...action('project-folder','folder'),target:'D:\\Motion projects\\Scene 2026'};
  const branch=group('tools',[folder,group('extras',[action('editor')])]);
  const original=configuration([group('outer',[group('inner',[branch])]),action('root-action')]);
  const snapshot=structuredClone(original),movedGroup=moveActionToRoot(original,'tools');
  assert.deepEqual(movedGroup.menus[0].items.at(-1),branch);
  assert.equal(movedGroup.menus[0].items[0].children[0].children.length,0);
  const movedFolder=moveActionToRoot(original,'project-folder');
  assert.deepEqual(movedFolder.menus[0].items.at(-1),folder);
  assert.deepEqual(validateState(movedGroup),movedGroup);
  assert.deepEqual(validateState(movedFolder),movedFolder);
  assert.deepEqual(original,snapshot);
});

test('root moves stay within the source menu even when another menu is active',async()=>{
  const {moveActionToRoot}=await import('../src/renderer/action-move.mjs');
  const original=configuration([group('main-group',[action('main-child')])]);
  original.menus.push({id:'second',name:'Second',icon:'orbit',items:[group('second-group',[action('second-child')])]});
  validateState(original);
  const snapshot=structuredClone(original),moved=moveActionToRoot(original,'second-child');
  assert.equal(moved.activeMenuId,'main');
  assert.deepEqual(moved.menus[0],snapshot.menus[0]);
  assert.deepEqual(moved.menus[1].items.map(item=>item.id),['second-group','second-child']);
  assert.equal(moved.menus[1].items[0].children.length,0);
  assert.deepEqual(validateState(moved),moved);
  assert.deepEqual(original,snapshot);
});

test('already-root moves are cloned no-ops even when the root is full',async()=>{
  const {moveActionToRoot}=await import('../src/renderer/action-move.mjs');
  const original=configuration(Array.from({length:12},(_,index)=>action(`root-${index}`)));
  const moved=moveActionToRoot(original,'root-5');
  assert.notEqual(moved,original);
  assert.deepEqual(moved,original);
  assert.deepEqual(validateState(moved),moved);
});

test('missing actions and full roots reject before detaching the source',async()=>{
  const {moveActionToRoot}=await import('../src/renderer/action-move.mjs');
  const original=configuration([group('adobe',[action('illustrator')]),...Array.from({length:11},(_,index)=>action(`root-${index}`))]);
  const snapshot=structuredClone(original);
  assert.throws(()=>moveActionToRoot(original,'missing'),/Дію для переміщення не знайдено/);
  assert.deepEqual(original,snapshot);
  assert.throws(()=>moveActionToRoot(original,'illustrator'),/У головному меню вже 12 дій/);
  assert.deepEqual(original,snapshot);
  assert.deepEqual(validateState(original),snapshot);
});

test('sector reorder inserts at the target original index in either direction',async()=>{
  const {reorderAction}=await import('../src/renderer/action-move.mjs');
  const original=configuration(['a','b','c','d','e'].map(id=>action(id)));
  const snapshot=structuredClone(original);
  for(const [source,target,expected]of [
    ['a','c',['b','c','a','d','e']],
    ['e','b',['a','e','b','c','d']],
    ['d','b',['a','d','b','c','e']],
    ['b','d',['a','c','d','b','e']],
    ['a','e',['b','c','d','e','a']],
    ['e','a',['e','a','b','c','d']],
  ]){
    const moved=reorderAction(original,source,target);
    assert.deepEqual(moved.menus[0].items.map(item=>item.id),expected);
    assert.deepEqual(validateState(moved),moved);
    assert.deepEqual(original,snapshot);
  }
});

test('nested sector reorder preserves group metadata and subtrees and permits self no-ops',async()=>{
  const {reorderAction}=await import('../src/renderer/action-move.mjs');
  const branch=group('tools',[action('editor')]);
  const original=configuration([group('adobe',[action('illustrator'),branch,action('photoshop')])]);
  const snapshot=structuredClone(original),moved=reorderAction(original,'tools','photoshop');
  assert.deepEqual(moved.menus[0].items[0].children.map(item=>item.id),['illustrator','photoshop','tools']);
  assert.deepEqual(moved.menus[0].items[0].children[2],branch);
  assert.deepEqual(validateState(moved),moved);
  const same=reorderAction(original,'tools','tools');
  assert.notEqual(same,original);assert.deepEqual(same,original);
  assert.deepEqual(original,snapshot);
});

test('sector reorder rejects missing or nonsibling targets without losing actions',async()=>{
  const {reorderAction}=await import('../src/renderer/action-move.mjs');
  const original=configuration([action('app'),group('adobe',[action('child')])]);
  original.menus.push({id:'second',name:'Second',icon:'orbit',items:[action('other-root')]});validateState(original);
  const snapshot=structuredClone(original);
  for(const [source,target,message]of [
    ['missing','app',/Дію для переміщення/],['app','missing',/Дію призначення/],
    ['app','child',/одного рівня/],['app','other-root',/одного рівня/],
  ]){
    assert.throws(()=>reorderAction(original,source,target),message);
    assert.deepEqual(original,snapshot);
  }
});

test('center drop moves a nested action exactly one level up rather than directly to root',async()=>{
  const {moveActionToParent}=await import('../src/renderer/action-move.mjs');
  const original=configuration([group('adobe',[action('before'),group('motion',[action('after-effects'),action('premiere')]),action('after')]),action('root-app')]);
  const snapshot=structuredClone(original),moved=moveActionToParent(original,'after-effects');
  assert.deepEqual(moved.menus[0].items.map(item=>item.id),['adobe','root-app']);
  assert.deepEqual(moved.menus[0].items[0].children.map(item=>item.id),['before','motion','after','after-effects']);
  assert.deepEqual(moved.menus[0].items[0].children[1].children.map(item=>item.id),['premiere']);
  assert.deepEqual(moved.menus[0].items[0].children.at(-1),snapshot.menus[0].items[0].children[1].children[0]);
  assert.deepEqual(validateState(moved),moved);
  assert.deepEqual(original,snapshot);
});

test('parent moves preserve deep group subtrees and stay in their containing menu',async()=>{
  const {moveActionToParent}=await import('../src/renderer/action-move.mjs');
  const branch=group('tools',[action('editor'),group('extras',[action('render')])]);
  const original=configuration([action('main-app')]);
  original.menus.push({id:'second',name:'Second',icon:'orbit',items:[group('outer',[group('inner',[branch])])]});validateState(original);
  const snapshot=structuredClone(original),moved=moveActionToParent(original,'tools');
  assert.deepEqual(moved.menus[0],snapshot.menus[0]);
  assert.equal(moved.menus[1].items[0].children[0].children.length,0);
  assert.deepEqual(moved.menus[1].items[0].children.map(item=>item.id),['inner','tools']);
  assert.deepEqual(moved.menus[1].items[0].children[1],branch);
  assert.deepEqual(validateState(moved),moved);
  assert.deepEqual(original,snapshot);
});

test('parent move capacity checks use the immediate destination and reject before detach',async()=>{
  const {moveActionToParent}=await import('../src/renderer/action-move.mjs');
  const original=configuration([group('outer',[group('inner',[action('child')]),...Array.from({length:11},(_,index)=>action(`sibling-${index}`))])]);
  const snapshot=structuredClone(original);
  assert.throws(()=>moveActionToParent(original,'child'),/На рівні вище вже 12 дій/);
  assert.throws(()=>moveActionToParent(original,'missing'),/Дію для переміщення не знайдено/);
  assert.deepEqual(original,snapshot);
  const fullRoot=configuration([group('adobe',[action('nested-app')]),...Array.from({length:11},(_,index)=>action(`root-${index}`))]);
  assert.throws(()=>moveActionToParent(fullRoot,'nested-app'),/12 дій/);
  const noOp=moveActionToParent(fullRoot,'adobe');
  assert.notEqual(noOp,fullRoot);assert.deepEqual(noOp,fullRoot);
  assert.deepEqual(validateState(noOp),noOp);
});

test('a direct group child can move one level up into the root as its final item',async()=>{
  const {moveActionToParent}=await import('../src/renderer/action-move.mjs');
  const original=configuration([group('adobe',[action('illustrator')]),action('browser')]);
  const moved=moveActionToParent(original,'illustrator');
  assert.deepEqual(moved.menus[0].items.map(item=>item.id),['adobe','browser','illustrator']);
  assert.equal(moved.menus[0].items[0].children.length,0);
  assert.deepEqual(validateState(moved),moved);
  assert.equal(original.menus[0].items[0].children.length,1);
});
