function findAction(state,id){
    for(const menu of state.menus){
      const walk=(items,depth=0,parent=null)=>{
        for(let index=0;index<items.length;index++){
          const item=items[index];
          if(item.id===id)return {item,items,index,depth,parent};
          if(item.kind==='group'){
            const found=walk(item.children,depth+1,item);
            if(found)return found;
          }
        }
        return null;
      };
      const found=walk(menu.items);
      if(found)return found;
    }
    return null;
}

/** Return a drop validation message without allocating or modifying a cloned state. */
export function actionMoveError(state,sourceId,targetGroupId){
  const source=findAction(state,sourceId),target=findAction(state,targetGroupId);
  if(!source)return 'Дію для переміщення не знайдено.';
  if(!target)return 'Групу призначення не знайдено.';
  if(target.item.kind!=='group')return 'Перемістити дію можна лише в групу.';
  if(source.item.id===target.item.id)return 'Групу не можна перемістити в саму себе.';
  const contains=(item,id)=>item.id===id||item.kind==='group'&&item.children.some(child=>contains(child,id));
  if(contains(source.item,target.item.id))return 'Групу не можна перемістити у власну вкладену групу.';
  if(source.parent===target.item)return null;
  if(target.item.children.length>=12)return 'У цій групі вже 12 дій. Спочатку звільніть місце.';
  const subtreeDepth=item=>item.kind==='group'&&item.children.length?1+Math.max(...item.children.map(subtreeDepth)):0;
  if(target.depth+1+subtreeDepth(source.item)>4)return 'Переміщення перевищить обмеження у чотири вкладені рівні.';
  return null;
}

/** Move one existing action into a group without mutating the saved configuration. */
export function moveActionToGroup(state,sourceId,targetGroupId){
  const error=actionMoveError(state,sourceId,targetGroupId);
  if(error)throw new Error(error);
  const next=structuredClone(state);
  const source=findAction(next,sourceId),target=findAction(next,targetGroupId);
  if(source.parent===target.item)return next;
  source.items.splice(source.index,1);
  target.item.children.push(source.item);
  return next;
}
