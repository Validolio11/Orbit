import {actionMoveError} from './action-move.mjs';

const MIME='application/x-orbit-action';

export function bindActionDrag(root,{getState,onMove,onError}){
  let sourceId=null,targetRow=null,blockedUntil=0,busy=false;
  function highlight(row,error=null){
    if(targetRow!==row){targetRow?.classList.remove('drop-target','drop-rejected');targetRow=row;}
    if(!row)return;
    row.classList.toggle('drop-target',!error);row.classList.toggle('drop-rejected',!!error);
    row.querySelector('.action-drop-message').textContent=error||'Відпустіть, щоб перемістити сюди';
  }
  function reset(){
    if(sourceId)blockedUntil=performance.now()+300;
    sourceId=null;highlight(null);root.querySelectorAll('.action-dragging').forEach(row=>row.classList.remove('action-dragging'));
  }
  root.addEventListener('pointerdown',()=>{if(!sourceId)blockedUntil=0;});
  root.addEventListener('dragstart',event=>{
    const row=event.target.closest('.action-list [data-row-id][draggable="true"]');
    if(!row)return;
    if(busy||event.target.closest('button')||!event.dataTransfer){event.preventDefault();return;}
    sourceId=row.dataset.rowId;
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData(MIME,sourceId);
    row.classList.add('action-dragging');
  });
  root.addEventListener('dragover',event=>{
    if(!sourceId)return;
    const row=event.target.closest('.action-list [data-drop-group]');
    if(!row){highlight(null);return;}
    const error=actionMoveError(getState(),sourceId,row.dataset.dropGroup);
    highlight(row,error);
    if(event.dataTransfer)event.dataTransfer.dropEffect=error?'none':'move';
    if(!error)event.preventDefault();
  });
  root.addEventListener('dragleave',event=>{
    if(!sourceId||root.contains(event.relatedTarget))return;
    const b=root.getBoundingClientRect();
    if(event.clientX<=b.left||event.clientX>=b.right||event.clientY<=b.top||event.clientY>=b.bottom)highlight(null);
  });
  root.addEventListener('drop',async event=>{
    if(!sourceId)return;
    event.preventDefault();
    const row=event.target.closest('.action-list [data-drop-group]'),id=sourceId,targetId=row?.dataset.dropGroup;
    const matching=event.dataTransfer?.getData(MIME)===id;
    const error=targetId?actionMoveError(getState(),id,targetId):null;
    reset();
    if(!matching||!targetId)return;
    if(error){onError(error);return;}
    busy=true;
    try{await onMove(id,targetId);}catch(error){onError(error.message);}finally{busy=false;}
  });
  root.addEventListener('dragend',reset);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sourceId)reset();},true);
  return {reset,suppressClick:()=>performance.now()<blockedUntil};
}
