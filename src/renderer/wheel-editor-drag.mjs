import {sectorAt,escapeHTML as e} from './wheel.mjs';
import {itemIcon} from './icons.mjs';

export function bindWheelEditorDrag(root,{getItems,parentDropError,onReorder,onMoveParent,onError}){
  let gesture=null,ghost=null,target=null,blockedUntil=0,busy=false;
  function clearTarget(){
    root.querySelectorAll('#preview-wheel .reorder-target,#preview-wheel .parent-drop,#preview-wheel .parent-drop-rejected').forEach(node=>node.classList.remove('reorder-target','parent-drop','parent-drop-rejected'));
    const label=root.querySelector('#preview-wheel .wheel-center small');
    if(label?.dataset.beforeDrop!==undefined){label.textContent=label.dataset.beforeDrop;delete label.dataset.beforeDrop;}
    target=null;
  }
  function reset(suppress=true){
    const previous=gesture;gesture=null;
    if(previous?.active&&suppress)blockedUntil=performance.now()+300;
    clearTarget();ghost?.remove();ghost=null;
    root.querySelectorAll('#preview-wheel .editor-drag-source').forEach(node=>node.classList.remove('editor-drag-source'));
    root.classList.remove('wheel-editor-dragging');
    try{if(previous?.mount.hasPointerCapture(previous.pointerId))previous.mount.releasePointerCapture(previous.pointerId);}catch{}
  }
  function updateTarget(event){
    const mount=gesture.mount,box=mount.getBoundingClientRect();
    const x=(event.clientX-box.left-box.width/2)*480/box.width,y=(event.clientY-box.top-box.height/2)*480/box.height;
    clearTarget();
    if(Math.hypot(x,y)<=74.4){
      const error=parentDropError();
      const center=mount.querySelector('.wheel-center'),label=center.querySelector('small');
      label.dataset.beforeDrop=label.textContent;
      label.textContent=error||'Перемістити на рівень вище';
      center.classList.add(error?'parent-drop-rejected':'parent-drop');
      target={kind:'parent',error};return;
    }
    // Count rendered sectors so the trailing "+" slot keeps the geometry but is never a target.
    const item=getItems()[sectorAt(x,y,mount.querySelectorAll('.wheel-sector').length,92,207)];
    if(!item||item.id===gesture.id)return;
    for(const node of mount.querySelectorAll('[data-sector],[data-wheel-id]'))if(node.dataset.sector===item.id||node.dataset.wheelId===item.id)node.classList.add('reorder-target');
    target={kind:'reorder',id:item.id};
  }
  root.addEventListener('pointerdown',event=>{
    if(!gesture)blockedUntil=0;
    if(busy||event.button!==0||!event.isPrimary)return;
    const mount=event.target.closest('#preview-wheel'),source=event.target.closest('[data-sector],[data-wheel-id]');
    if(!mount||!source)return;
    const id=source.dataset.sector||source.dataset.wheelId;
    if(!getItems().some(item=>item.id===id))return;
    gesture={id,mount,pointerId:event.pointerId,x:event.clientX,y:event.clientY,active:false};
  });
  root.addEventListener('dragstart',event=>{if(event.target.closest('#preview-wheel'))event.preventDefault();});
  window.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    if(!gesture.active){
      if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<6)return;
      gesture.active=true;gesture.mount.setPointerCapture(event.pointerId);root.classList.add('wheel-editor-dragging');
      for(const node of gesture.mount.querySelectorAll('[data-sector],[data-wheel-id]'))if(node.dataset.sector===gesture.id||node.dataset.wheelId===gesture.id)node.classList.add('editor-drag-source');
      const item=getItems().find(item=>item.id===gesture.id);
      ghost=document.createElement('div');ghost.className='wheel-drag-ghost';ghost.setAttribute('aria-hidden','true');ghost.innerHTML=`${itemIcon(item,20)}<span>${e(item.name)}</span>`;root.append(ghost);
    }
    event.preventDefault();ghost.style.left=event.clientX+14+'px';ghost.style.top=Math.max(8,event.clientY-38)+'px';updateTarget(event);
  },{passive:false});
  window.addEventListener('pointerup',async event=>{
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    if(!gesture.active){reset(false);return;}
    event.preventDefault();updateTarget(event);
    const id=gesture.id,drop=target;reset();
    if(!drop)return;
    if(drop.error){onError(drop.error);return;}
    busy=true;
    try{if(drop.kind==='parent')await onMoveParent(id);else await onReorder(id,drop.id);}
    catch(error){onError(error.message);}finally{busy=false;}
  },true);
  window.addEventListener('pointercancel',()=>reset());
  root.addEventListener('lostpointercapture',event=>{if(gesture?.active&&event.target===gesture.mount)reset();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&gesture){event.preventDefault();reset();}},true);
  return {reset,suppressClick:()=>performance.now()<blockedUntil};
}
