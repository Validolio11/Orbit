import {icon,itemIcon,rememberAppIcon,hydrateAppIcons,systemIcons} from './icons.mjs';
import {escapeHTML as e,renderWheel,sectorAt} from './wheel.mjs';
import {appPickerFields,mountAppPicker} from './app-picker.mjs';
import {updatesSettings,refreshUpdates} from './updates.mjs';
import {bindActionDrag} from './action-drag.mjs';
import {bindWheelEditorDrag} from './wheel-editor-drag.mjs';
import {moveActionToGroup,moveActionToRoot,reorderAction,moveActionToParent} from './action-move.mjs';

const api=window.orbit;
const overlay=new URLSearchParams(location.search).has('overlay');
const root=document.querySelector('#app');
const kinds={app:'Застосунок',folder:'Папка',script:'Скрипт',system:'Windows',group:'Група'};
const systemNames={explorer:'Провідник', 'task-manager':'Диспетчер завдань',screenshot:'Знімок екрана',mute:'Вимкнути / увімкнути звук','volume-up':'Збільшити гучність','volume-down':'Зменшити гучність',desktop:'Показати робочий стіл',settings:'Параметри Windows',lock:'Заблокувати комп’ютер','media-play':'Відтворення / пауза'};
const activationNames={release:'Відпускання кнопки',hover:'Наведення курсора',click:'Клацання мишею'};
const groupOpenNames={hover:'Наведення курсора',click:'Клацання мишею'};
let state,runtime={hookReady:false,hookError:null,shortcutRegistered:false};
let updateStatus={phase:'idle',currentVersion:'0.1.1'};
let page='menus',selectedId='adobe',groupPath=[],search='',toastTimer,modalPreviousFocus,modalCleanup;
let wheelStack=[],wheelSelected=-1,wheelTrigger='preview',wheelTimer,groupTimer,wheelBusy=false,wheelOpen=false,mousePoint=null,transitionOrigin=null;
const uuid=()=>crypto.randomUUID();
const currentMenu=()=>state.menus.find(m=>m.id===state.activeMenuId)||state.menus[0];
function currentGroup(){let value={items:currentMenu().items,name:currentMenu().name};for(const id of groupPath){const item=value.items.find(i=>i.id===id);if(!item||item.kind!=='group')break;value={...item,items:item.children};}return value;}
function locate(id){for(const menu of state.menus){const walk=(items,path=[])=>{for(let i=0;i<items.length;i++){if(items[i].id===id)return {item:items[i],items,index:i,menu,path};if(items[i].kind==='group'){const found=walk(items[i].children,[...path,items[i].id]);if(found)return found;}}};const found=walk(menu.items);if(found)return found;}return null;}
function flatten(){const result=[];for(const menu of state.menus){const walk=(items,path=[])=>items.forEach(item=>{result.push({item,menu,path});if(item.kind==='group')walk(item.children,[...path,item.name]);});walk(menu.items);}return result;}
async function openEditorGroup(id){
  const found=locate(id);if(!found||found.item.kind!=='group')return;
  if(state.activeMenuId!==found.menu.id&&!await change({activeMenuId:found.menu.id}))return;
  groupPath=[...found.path,found.item.id];page='menus';selectedId='';render();
}
async function activateEditorItem(id){
  const found=locate(id);if(!found)return;
  if(found.item.kind==='group'){await openEditorGroup(id);return;}
  selectedId=id;actionDialog(id);render();
}
function applyTheme(){const theme=state.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):state.theme;document.documentElement.dataset.theme=theme;document.documentElement.dataset.reducedMotion=String(state.reducedMotion);}
function toast(message,error=false){const target=document.querySelector('#toast');clearTimeout(toastTimer);target.textContent=message;target.className='visible'+(error?' error':'');toastTimer=setTimeout(()=>target.className='',error?6000:2500);}
async function save(next,message){try{state=await api.saveState(next);applyTheme();if(!overlay)render();if(message)toast(message);return true;}catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''),true);return false;}}
const change=(changes,message)=>save({...state,...changes},message);
const actionDrag=overlay?null:bindActionDrag(root,{
  getState:()=>state,
  onError:message=>toast(message,true),
  onMove:async(sourceId,targetId)=>{
    const target=locate(targetId)?.item,next=moveActionToGroup(state,sourceId,targetId),previous=selectedId;
    selectedId=targetId;
    if(await save(next,`Переміщено до «${target.name}»`)){
      [...root.querySelectorAll('.action-list [data-row-id]')].find(row=>row.dataset.rowId===targetId)?.focus({preventScroll:true});
    }else selectedId=previous;
  },
});
const wheelEditorDrag=overlay?null:bindWheelEditorDrag(root,{
  getItems:()=>currentGroup().items,
  parentDropError:()=>{
    if(!groupPath.length)return 'Уже в головному меню';
    const parentItems=groupPath.length===1?currentMenu().items:locate(groupPath.at(-2)).item.children;
    return parentItems.length>=12?'На попередньому рівні вже 12 дій':null;
  },
  onReorder:async(id,target)=>{await save(reorderAction(state,id,target),'Порядок змінено');},
  onMoveParent:async id=>{await save(moveActionToParent(state,id),'Переміщено на рівень вище');},
  onError:message=>toast(message,true),
});
function statusLabel(){return !state.enabled?'Призупинено':runtime.hookReady?'Orbit активний':runtime.hookError?'Миша недоступна':'Запуск модуля миші…';}
function statusMarkup(){return `<span class="status-badge ${!state.enabled||!runtime.hookReady?'off':''}"><span class="status-dot ${!state.enabled||!runtime.hookReady?'off':''}"></span>${e(statusLabel())}</span>`;}

function render(){
  actionDrag?.reset();
  wheelEditorDrag?.reset();
  const count=state.menus.length;
  root.innerHTML=`<div class="app-shell">
    <header class="titlebar"><div class="title-brand">${icon('orbit',24)}<span>Orbit</span><span class="version">${e(updateStatus.currentVersion)}</span></div><div class="titlebar-center">Ваші інструменти. Поруч.</div><div class="window-controls"><button class="window-control" data-command="minimize" aria-label="Згорнути">${icon('minus',15)}</button><button class="window-control" data-command="maximize" aria-label="Розгорнути">${icon('app',13)}</button><button class="window-control close" data-command="close-window" aria-label="Згорнути в трей">${icon('close',16)}</button></div></header>
    <aside class="sidebar"><div class="sidebar-label">Робочий простір</div><nav aria-label="Основна навігація">
      ${[['menus','wheel','Мої меню'],['library','grid','Усі дії'],['controls','mouse','Керування'],['settings','settings','Налаштування']].map(([id,ic,label])=>`<button class="nav-button ${page===id?'active':''}" data-page="${id}" ${page===id?'aria-current="page"':''}>${icon(ic,18)}${label}${id==='menus'?`<span class="nav-count">${count}</span>`:''}</button>`).join('')}
    </nav><div class="sidebar-bottom"><div class="engine-card"><div class="engine-title"><span class="status-dot ${state.enabled&&runtime.hookReady?'':'off'}"></span><span>${e(statusLabel())}</span></div><p>${state.enabled?'Виклик — бічна кнопка '+state.triggerButton:'Увімкніть у розділі «Керування»'}</p><kbd>Ctrl + Space</kbd></div><div class="sidebar-footer"><span>Локально на вашому ПК</span><button class="theme-button" data-command="toggle-theme" aria-label="Перемкнути тему">${icon(document.documentElement.dataset.theme==='dark'?'sun':'moon',14)}</button></div></div></aside>
    <main class="workspace"><div class="page"><div class="breadcrumb"><span>Робочий простір</span>${icon('chevron',10)}<span>${{menus:'Мої меню',library:'Усі дії',controls:'Керування',settings:'Налаштування'}[page]}</span></div>${page==='menus'?menusPage():page==='library'?libraryPage():page==='controls'?controlsPage():settingsPage()}</div></main>
  </div>`;
  if(page==='menus'){
    const group=currentGroup();
    renderWheel(document.querySelector('#preview-wheel'),group.items,{title:groupPath.length?group.name:'Orbit',selected:selectedId,back:!!groupPath.length});
  }
  hydrateAppIcons(root);
  root.querySelectorAll('.action-list [draggable="true"] img').forEach(image=>image.draggable=false);
}

function menusPage(){
  const menu=currentMenu(),group=currentGroup();
  return `<div class="page-header"><div><h1>Мої меню</h1><p>Програми, папки та команди — в одному русі.</p></div><div class="header-actions"><button class="btn" data-command="new-menu">${icon('plus',15)}Створити меню</button><button class="btn primary" data-command="preview">${icon('play',14)}Викликати колесо</button></div></div>
    <div class="menu-tabs" role="tablist" aria-label="Набори меню">${state.menus.map(m=>`<button class="menu-tab ${m.id===menu.id?'active':''}" data-menu-id="${e(m.id)}" role="tab" aria-selected="${m.id===menu.id}">${icon('wheel',14)}${e(m.name)}<span class="tiny-count">${m.items.length}</span></button>`).join('')}<div class="tabs-extra"><button class="icon-btn" data-command="rename-menu" aria-label="Перейменувати меню">${icon('edit',14)}</button><button class="icon-btn" data-command="duplicate-menu" aria-label="Дублювати меню">${icon('copy',14)}</button>${state.menus.length>1?`<button class="icon-btn danger" data-command="delete-menu" aria-label="Видалити меню">${icon('trash',14)}</button>`:''}</div></div>
    <div class="menu-editor"><section class="panel preview-panel"><div class="panel-head"><h2>Попередній перегляд</h2><span class="micro-label">${group.items.length} / 12</span></div><div class="preview-surface">${groupPath.length?`<button class="btn small preview-back" data-command="group-back">${icon('back',13)}Назад</button>`:''}<div class="wheel-mount" id="preview-wheel"></div><span class="preview-label">${groupPath.length?e(group.name.toUpperCase()):'ORBIT / RADIAL MENU'}</span></div><div class="preview-bottom">${icon('info',15)}<span>Перетягніть сектор, щоб змінити порядок. Центр переносить дію на рівень вище.</span></div></section>
    <section class="panel"><div class="panel-head"><h2>${groupPath.length?e(group.name):'Дії в меню'}</h2><button class="btn small ghost" data-command="add-action" ${group.items.length>=12?'disabled':''}>${icon('plus',13)}Додати</button></div><div class="action-list">${group.items.length?group.items.map((item,i)=>actionRow(item,i)).join(''):`<div class="empty-state">${icon('plus',26)}<strong>Поки що порожньо</strong><p>Додайте програму, папку або команду до цього колеса.</p><button class="btn" data-command="add-action">Додати дію</button></div>`}</div><div class="list-footer"><span>${groupPath.length?'Вкладене меню':'Перетягніть дію на групу, щоб перемістити'}</span><span>${group.items.length} / 12</span></div></section></div>
    <div class="quick-settings"><button class="quick-setting" data-page="controls">${icon('mouse',22)}<span class="setting-copy"><strong>Бічна кнопка ${state.triggerButton}</strong><small>Виклик колеса · Ctrl + Space</small></span>${icon('chevron',14)}</button><button class="quick-setting" data-page="controls">${icon(state.activationMode==='hover'?'mouse':'play',21)}<span class="setting-copy"><strong>${activationNames[state.activationMode]}</strong><small>${state.activationMode==='hover'?`Затримка ${state.hoverDelay} мс`:'Спосіб запуску обраної дії'}</small></span>${icon('chevron',14)}</button></div>
    <div class="page-foot"><span>${icon('check',12)}Зміни зберігаються автоматично</span>${statusMarkup()}</div>`;
}
function actionDescription(item){if(item.kind==='group')return `${item.children.length} ${item.children.length===1?'дія':'дій'} у вкладеному меню`;if(item.kind==='system')return systemNames[item.target]||'Системна команда';return item.target||'Виберіть шлях до застосунку';}
function actionRow(item,index,library=false,context=''){
  return `<div class="action-row ${selectedId===item.id?'selected':''}" data-row-id="${e(item.id)}" ${!library?`draggable="true" title="Перетягніть у групу" ${item.kind==='group'?`data-drop-group="${e(item.id)}"`:''}`:''} tabindex="0" role="button" aria-label="${item.kind==='group'?'Відкрити':'Редагувати'} ${e(item.name)}">${!library?`<span class="action-number">${String(index+1).padStart(2,'0')}</span>`:''}<span class="action-icon">${itemIcon(item,19)}</span><div class="action-copy"><div class="action-name">${e(item.name)}</div><div class="action-desc" title="${e(actionDescription(item))}">${e(context||actionDescription(item))}</div>${!library&&item.kind==='group'?'<div class="action-drop-message" aria-live="polite"></div>':''}</div>${library?`<span class="type-badge">${kinds[item.kind]}</span>`:''}<div class="action-tools">${!library&&groupPath.length?`<button class="icon-btn move-root" data-move-root="${e(item.id)}" aria-label="Перемістити ${e(item.name)} в головне меню" title="Перемістити в головне меню">${icon('moveRoot',13)}</button>`:''}${!library?`<button class="icon-btn reorder" data-move-id="${e(item.id)}" data-direction="-1" aria-label="Перемістити ${e(item.name)} вище" ${index===0?'disabled':''}>${icon('arrowUp',12)}</button>`:''}${item.kind==='group'?`<button class="icon-btn" data-open-group="${e(item.id)}" aria-label="Відкрити групу ${e(item.name)}">${icon('chevron',15)}</button><button class="icon-btn" data-edit-id="${e(item.id)}" aria-label="Редагувати ${e(item.name)}" title="Редагувати групу">${icon('edit',13)}</button><button class="icon-btn danger" data-delete-group="${e(item.id)}" aria-label="Видалити групу ${e(item.name)}" title="Видалити групу">${icon('trash',13)}</button>`:`<button class="icon-btn" data-edit-id="${e(item.id)}" aria-label="Редагувати ${e(item.name)}">${icon('edit',13)}</button><button class="icon-btn danger" data-delete-action="${e(item.id)}" aria-label="Видалити дію ${e(item.name)}" title="Видалити дію">${icon('trash',13)}</button>`}</div></div>`;
}
function libraryPage(){
  const entries=flatten().filter(({item,path,menu})=>(item.name+' '+kinds[item.kind]+' '+menu.name+' '+path.join(' ')).toLowerCase().includes(search.toLowerCase()));
  return `<div class="page-header"><div><h1>Усі дії</h1><p>Знайдіть і налаштуйте дію в будь-якому меню.</p></div><button class="btn primary" data-command="add-action">${icon('plus',15)}Додати дію</button></div><div class="library-toolbar"><label class="search-box">${icon('search',16)}<input id="action-search" placeholder="Знайти дію…" aria-label="Знайти дію" value="${e(search)}"></label><span class="micro-label" aria-live="polite">${entries.length} дій</span></div><section class="panel library-list">${entries.length?entries.map(({item,path,menu},i)=>actionRow(item,i,true,[menu.name,...path].join(' / '))).join(''):'<div class="empty-state"><strong>Дій не знайдено</strong><p>Спробуйте іншу назву.</p></div>'}</section>`;
}
function controlsPage(){
  return `<div class="page-header"><div><h1>Керування</h1><p>Налаштуйте мишу та спосіб вибору дій.</p></div>${statusMarkup()}</div><div class="settings-stack">
    <section class="settings-section"><div class="mouse-visual"><div class="mouse-diagram" aria-hidden="true"><span class="mouse-side first ${state.triggerButton===5?'inactive':''}"></span><span class="mouse-side second ${state.triggerButton===5?'active':''}"></span></div><div><h2>Ваша миша. Ваші команди.</h2><p>Стандартні бічні кнопки Mouse 4 та Mouse 5.</p>${statusMarkup()}</div></div>
    <div class="setting-row"><div class="setting-label"><strong>Orbit у фоновому режимі</strong><p>Коли ввімкнено, обрана бічна кнопка викликає колесо замість переходу назад або вперед.</p></div><button class="toggle ${state.enabled?'on':''}" data-toggle="enabled" role="switch" aria-checked="${state.enabled}" aria-label="Orbit у фоновому режимі"></button></div>
    <div class="setting-row"><div class="setting-label"><strong>Кнопка виклику</strong><p>Затисніть кнопку, щоб відкрити колесо біля курсора.</p></div><select class="select" data-preference="triggerButton" aria-label="Кнопка виклику"><option value="4" ${state.triggerButton===4?'selected':''}>Mouse 4 · назад</option><option value="5" ${state.triggerButton===5?'selected':''}>Mouse 5 · вперед</option></select></div>
    <div class="setting-row"><div class="setting-label"><strong>Клавіатурний виклик</strong><p>${runtime.shortcutRegistered?'Доступний у будь-якій програмі.':runtime.hookError?'Скорочення недоступне: можливо, його зайняла інша програма.':'Додатковий спосіб відкрити колесо.'}</p></div><kbd>Ctrl + Space</kbd></div></section>
    <section class="settings-section"><div class="section-intro"><h2>Вибір дії</h2><p>Оберіть поведінку, яка підходить вашому робочому процесу.</p></div><div class="setting-row"><div class="setting-label"><strong>Запускати дію</strong><p>${state.activationMode==='release'?'Наведіть на сектор і відпустіть бічну кнопку.':state.activationMode==='hover'?'Затримайте курсор над сектором для запуску.':'Натисніть лівою кнопкою на потрібний сектор.'}</p></div><select class="select" data-preference="activationMode" aria-label="Спосіб запуску">${Object.entries(activationNames).map(([value,label])=>`<option value="${value}" ${state.activationMode===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="setting-row"><div class="setting-label"><strong>Відкривати вкладки</strong><p>${state.groupOpenMode==='click'?'Натисніть лівою кнопкою на вкладку, щоб відкрити її.':'Наведіть курсор на вкладку, щоб відкрити її.'}</p></div><select class="select" data-preference="groupOpenMode" aria-label="Спосіб відкриття вкладок">${Object.entries(groupOpenNames).map(([value,label])=>`<option value="${value}" ${(state.groupOpenMode??'hover')===value?'selected':''}>${label}</option>`).join('')}</select></div>${state.activationMode==='hover'?`<div class="setting-row"><div class="setting-label"><strong>Затримка наведення</strong><p>Збільште, якщо дії запускаються випадково.</p></div><select class="select" data-preference="hoverDelay" aria-label="Затримка наведення">${[150,250,350,500,750,1000,1500,2000].map(v=>`<option value="${v}" ${state.hoverDelay===v?'selected':''}>${v} мс</option>`).join('')}</select></div>`:''}</section>
    <div class="info-box">${icon('info',17)}<span>Вкладені групи відкриваються наведенням. Центр колеса повертає на рівень вище. <kbd>Esc</kbd> закриває колесо. Спеціальні кнопки мишей можуть потребувати налаштування у програмі виробника.</span></div>${runtime.hookError?`<div class="info-box">${icon('info',17)}<span>${e(runtime.hookError)}</span></div>`:''}<button class="btn" data-command="preview">${icon('play',14)}Перевірити колесо</button></div>`;
}
function wheelSizeSetting(){
  const percent=Math.round((state.wheelSize??520)/520*100);
  return `<div class="setting-row"><div class="setting-label"><label for="wheel-size"><strong>Розмір кола</strong></label><p>Масштаб меню під час виклику.</p></div><div class="wheel-size-control"><div class="wheel-size-slider"><input id="wheel-size" type="range" min="60" max="150" step="5" value="${percent}" data-preference="wheelSize" aria-valuetext="${percent}%" style="--range-progress:${(percent-60)/90*100}%"><output id="wheel-size-value" for="wheel-size">${percent}%</output></div><div class="wheel-size-actions"><button class="btn small ghost" data-command="reset-wheel-size" ${state.wheelSize===520?'disabled':''}>Скинути до 100%</button><button class="btn small" data-command="preview">${icon('play',12)}Перевірити</button></div></div></div>`;
}
function settingsPage(){
  return `<div class="page-header"><div><h1>Налаштування</h1><p>Зовнішній вигляд і ваші локальні дані.</p></div></div><div class="settings-stack"><section class="settings-section"><div class="section-intro"><h2>Зовнішній вигляд</h2><p>Чіткий інтерфейс на основі Geist.</p></div><div class="setting-row"><div class="setting-label"><strong>Тема</strong><p>Застосовується до редактора й колеса.</p></div><div class="segmented" role="group" aria-label="Тема інтерфейсу">${[['light','sun','Світла'],['dark','moon','Темна'],['system','system','Системна']].map(([id,ic,label])=>`<button class="${state.theme===id?'active':''}" data-theme-value="${id}" aria-pressed="${state.theme===id}">${icon(ic,14)}${label}</button>`).join('')}</div></div>${wheelSizeSetting()}<div class="setting-row"><div class="setting-label"><strong>Зменшити анімації</strong><p>Миттєві переходи без зміни масштабу.</p></div><button class="toggle ${state.reducedMotion?'on':''}" data-toggle="reducedMotion" role="switch" aria-checked="${state.reducedMotion}" aria-label="Зменшити анімації"></button></div></section>
    <section class="settings-section"><div class="section-intro"><h2>Поведінка колеса</h2><p>Налаштуйте закриття кругового меню.</p></div><div class="setting-row"><div class="setting-label"><strong>Закривати меню натисканням поза ним</strong><p>Натискання поза колом скасовує вибір так само, як Esc.</p></div><button class="toggle ${state.closeOnOutsideClick!==false?'on':''}" data-toggle="closeOnOutsideClick" role="switch" aria-checked="${state.closeOnOutsideClick!==false}" aria-label="Закривати меню натисканням поза ним"></button></div></section>
    ${updatesSettings(updateStatus)}
    <section class="settings-section"><div class="section-intro"><h2>Налаштування меню</h2><p>Збережіть резервну копію або перенесіть меню на інший комп’ютер.</p></div><div class="setting-row"><div class="setting-label"><strong>Експорт</strong><p>Меню, шляхи та налаштування у JSON-файлі.</p></div><button class="btn" data-command="export">${icon('export',15)}Експортувати</button></div><div class="setting-row"><div class="setting-label"><strong>Імпорт</strong><p>Замінює поточні меню. Перед імпортом можна зробити резервну копію.</p></div><button class="btn" data-command="import">${icon('import',15)}Імпортувати</button></div></section>
    <section class="settings-section"><div class="setting-row"><div class="setting-label"><strong>Orbit <span class="mono" style="font-size:10px;color:var(--muted)">${e(updateStatus.currentVersion)}</span></strong><p>Windows · локальне зберігання · без облікового запису</p></div>${icon('orbit',32)}</div></section><div class="info-box">${icon('info',17)}<span>Кнопка закриття згортає Orbit у системний трей. Щоб завершити роботу, оберіть «Вийти з Orbit» у меню іконки біля годинника.</span></div></div>`;
}

function closeModal(){modalCleanup?.();modalCleanup=null;document.querySelector('#modal-root').innerHTML='';modalPreviousFocus?.focus();}
function modal(title,body,footer,reuseAction=false){
  modalCleanup?.();modalCleanup=null;
  const existing=reuseAction?document.querySelector('.modal:has(#action-form)'):null;
  if(existing){
    existing.querySelector('#modal-title').textContent=title;
    const content=document.createElement('template');content.innerHTML=body;
    existing.querySelector('.modal-body').replaceWith(content.content);
    existing.querySelector('.modal-footer').innerHTML=footer;
  }else{
    modalPreviousFocus=document.activeElement;
    document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${e(title)}</h2><button class="icon-btn" data-command="dismiss" aria-label="Закрити">${icon('close',18)}</button></header>${body}<footer class="modal-footer">${footer}</footer></section></div>`;
  }
  queueMicrotask(()=>{
    const target=existing?document.querySelector('.modal .kind-choice.active'):document.querySelector('.modal input')||document.querySelector('.modal button');
    target?.focus({preventScroll:true});
  });
}
function menuDialog(mode='new'){
  const menu=currentMenu();modal(mode==='rename'?'Перейменувати меню':'Нове меню',`<form id="menu-form" class="modal-body"><div class="field"><label for="menu-name">Назва меню</label><input id="menu-name" name="name" maxlength="100" required placeholder="Наприклад, Монтаж" value="${mode==='rename'?e(menu.name):''}"><small>Окремий набір дій для вашого робочого процесу.</small></div><p class="form-error" id="form-error"></p></form>`,`<button class="btn" data-command="dismiss">Скасувати</button><button class="btn primary" type="submit" form="menu-form">${mode==='rename'?'Зберегти':'Створити меню'}</button>`);
  document.querySelector('#menu-form').onsubmit=async event=>{event.preventDefault();const name=new FormData(event.target).get('name').trim();if(!name)return;const next=structuredClone(state);if(mode==='rename')next.menus.find(m=>m.id===menu.id).name=name;else{if(next.menus.length>=20){document.querySelector('#form-error').textContent='Можна створити до 20 меню.';return;}const id=uuid();next.menus.push({id,name,icon:'orbit',items:[]});next.activeMenuId=id;groupPath=[];}if(await save(next,mode==='rename'?'Назву збережено':'Меню створено'))closeModal();};
}
function deleteDialog(type,id){const item=type==='menu'?currentMenu():locate(id)?.item;if(!item)return;modal(type==='menu'?'Видалити меню?':'Видалити дію?',`<div class="modal-body"><p class="delete-copy">Видалити <strong>${e(item.name)}</strong>${item.kind==='group'||type==='menu'?' разом із вкладеними діями':''}? Файли та програми на комп’ютері залишаться на місці.</p></div>`,`<button class="btn" data-command="dismiss">Скасувати</button><button class="btn danger" id="confirm-delete">${icon('trash',14)}Видалити</button>`);document.querySelector('#confirm-delete').onclick=async()=>{const next=structuredClone(state);if(type==='menu'){next.menus=next.menus.filter(m=>m.id!==item.id);next.activeMenuId=next.menus[0].id;groupPath=[];}else{const old=state;state=next;const found=locate(id);found.items.splice(found.index,1);state=old;}if(await save(next,'Видалено'))closeModal();};}
function actionDialog(id){
  let existing=id?locate(id)?.item:null;
  let draft=existing?structuredClone(existing):{id:uuid(),name:'',kind:'app',target:'',args:'',icon:'',children:[]};
  const pickerConfig={query:existing?.kind==='app'?existing.name:'',selectedName:existing?.kind==='app'?existing.name:'',mode:/^https?:\/\//i.test(draft.target)?'url':'search',detailsOpen:!!draft.args};
  const parentGroup=currentGroup();if(!existing&&parentGroup.items.length>=12){toast('У цьому колесі вже 12 дій. Створіть групу або інше меню.',true);return;}
  function draw(){
    const targetField=draft.kind==='app'?appPickerFields(draft,pickerConfig):draft.kind==='group'?`<p class="field-note">Група відкриває вкладене колесо. Після збереження відкрийте її стрілкою у списку й додайте дії.</p>`:draft.kind==='system'?`<div class="field"><span class="field-title" id="system-title">Команда Windows</span><div class="kind-choices system-choices" role="group" aria-labelledby="system-title">${Object.entries(systemNames).map(([value,label])=>`<button class="kind-choice system-choice ${draft.target===value?'active':''}" data-system="${value}" type="button" aria-pressed="${draft.target===value}">${icon(systemIcons[value],19)}<span>${label}</span></button>`).join('')}</div></div>`:`<div class="field"><label for="action-target">${draft.kind==='folder'?'Шлях до папки':'Файл скрипту'}</label><div class="field-inline"><input id="action-target" name="target" value="${e(draft.target)}" placeholder="${draft.kind==='folder'?'C:\\Проєкти':'C:\\Scripts\\render.ps1'}" required><button class="btn" type="button" id="browse-target">Огляд…</button></div><small>${draft.kind==='script'?'Підтримуються .ps1, .py, .js та .cjs. Для Python потрібен встановлений Python Launcher.':'Відкриється у Провіднику Windows.'}</small></div>${draft.kind==='script'?`<div class="field"><label for="action-args">Аргументи <span style="color:var(--faint);font-weight:400">· необов’язково</span></label><input id="action-args" name="args" value="${e(draft.args)}" placeholder='Наприклад, "C:\\Projects\\scene.aep"'><small>Аргументи з пробілами беріть у подвійні лапки.</small></div>`:''}`;
    // Windows commands are named by the chosen tile, so they need no name field.
    const fields=draft.kind==='app'||draft.kind==='system'?targetField:`<div class="field"><label for="action-name">Назва</label><input id="action-name" name="name" maxlength="100" value="${e(draft.name)}" placeholder="Наприклад, Illustrator" required></div>${targetField}`;
    modal(existing?'Редагувати дію':'Додати дію',`<form class="modal-body" id="action-form"><div class="kind-choices" role="group" aria-label="Тип дії">${Object.entries(kinds).map(([kind,label])=>`<button class="kind-choice ${draft.kind===kind?'active':''}" data-kind="${kind}" type="button" aria-pressed="${draft.kind===kind}">${icon(kind,19)}${label}</button>`).join('')}</div>${fields}<p class="form-error" id="form-error" role="alert"></p></form>`,`${existing?`<button class="btn danger" type="button" id="delete-action">${icon('trash',14)}Видалити</button>`:''}<button class="btn" data-command="dismiss">Скасувати</button><button class="btn primary" type="submit" form="action-form">${existing?'Зберегти':'Додати дію'}</button>`,true);
    const capture=()=>{
      const form=new FormData(document.querySelector('#action-form'));
      if(draft.kind==='system'){draft.name=existing?.kind==='system'&&existing.target===draft.target?existing.name:systemNames[draft.target];draft.args='';return;}
      draft.name=String(form.get('name')||'').trim();draft.target=draft.kind==='group'?'':String(form.get('target')||'').trim();draft.args=String(form.get('args')||'');
    };
    if(draft.kind==='app')modalCleanup=mountAppPicker({form:document.querySelector('#action-form'),draft,config:pickerConfig,onChoose:entry=>{
      capture();if(!draft.name||draft.name===pickerConfig.selectedName)draft.name=entry.name;
      draft.target=entry.target;draft.args=entry.args||'';draft.icon='app';pickerConfig.mode='search';pickerConfig.selectedName=entry.name;pickerConfig.query=entry.name;
      rememberAppIcon(entry.target,entry.icon);draw();queueMicrotask(()=>document.querySelector('#action-name')?.focus());
    },onModeChange:mode=>{capture();pickerConfig.mode=mode;pickerConfig.query='';pickerConfig.selectedName='';draft.target='';draft.args='';draw();queueMicrotask(()=>document.querySelector(mode==='url'?'#action-target':'#app-search')?.focus());}});
    document.querySelectorAll('[data-kind]').forEach(button=>button.onclick=()=>{capture();const nextKind=button.dataset.kind;if(existing?.kind==='group'&&draft.children.length&&nextKind!=='group'){document.querySelector('#form-error').textContent='Спочатку видаліть або перенесіть дії з групи.';return;}if(draft.kind!==nextKind){draft.kind=nextKind;draft.target=nextKind==='system'?'explorer':'';draft.icon='';}draw();});
    document.querySelectorAll('[data-system]').forEach(button=>button.onclick=()=>{
      draft.target=button.dataset.system;
      document.querySelectorAll('[data-system]').forEach(other=>{const active=other===button;other.classList.toggle('active',active);other.setAttribute('aria-pressed',String(active));});
    });
    document.querySelector('#browse-target')?.addEventListener('click',async()=>{capture();try{const value=await api.pickTarget(draft.kind);if(value){draft.target=value;const name=value.split(/[\\/]/).pop().replace(/\.[^.]+$/,'');if(!draft.name||draft.name===pickerConfig.selectedName)draft.name=name;if(draft.kind==='app'){pickerConfig.mode='search';pickerConfig.selectedName=name;pickerConfig.query=name;draw();}else{document.querySelector('#action-target').value=value;document.querySelector('#action-name').value=draft.name;}}}catch(error){document.querySelector('#form-error').textContent=error.message;}});
    document.querySelector('#delete-action')?.addEventListener('click',()=>deleteDialog('action',draft.id));
    document.querySelector('#action-form').onsubmit=async event=>{event.preventDefault();capture();if(draft.kind==='app'&&!draft.target){document.querySelector('#form-error').textContent='Оберіть застосунок зі списку, файл або вкажіть посилання.';document.querySelector('#app-search,#action-target')?.focus();return;}if(!draft.name){document.querySelector('#form-error').textContent='Вкажіть назву дії.';document.querySelector('#action-name').focus();return;}const next=structuredClone(state),old=state;state=next;if(existing){const found=locate(existing.id);found.items[found.index]=draft;}else currentGroup().items.push(draft);state=old;if(await save(next,existing?'Дію збережено':'Дію додано')){selectedId=draft.id;closeModal();render();}};
  }draw();
}

root.addEventListener('click',async event=>{
  if(actionDrag?.suppressClick()&&event.target.closest('[data-row-id]')){event.preventDefault();return;}
  if(wheelEditorDrag?.suppressClick()&&event.target.closest('#preview-wheel')){event.preventDefault();return;}
  const button=event.target.closest('button');
  if(button?.dataset.page){page=button.dataset.page;groupPath=[];render();return;}
  if(button?.dataset.menuId){groupPath=[];selectedId='';await change({activeMenuId:button.dataset.menuId});return;}
  if(button?.dataset.wheelId&&!overlay){await activateEditorItem(button.dataset.wheelId);return;}
  if(button?.hasAttribute('data-wheel-back')&&!overlay){groupPath.pop();render();return;}
  if(button?.dataset.openGroup){await openEditorGroup(button.dataset.openGroup);return;}
  if(button?.dataset.editId){selectedId=button.dataset.editId;actionDialog(selectedId);return;}
  if(button?.dataset.moveRoot){
    try{
      const id=button.dataset.moveRoot,name=locate(id)?.item.name,next=moveActionToRoot(state,id);
      if(await save(next,`«${name}» переміщено в головне меню`)){
        root.querySelector('.action-list [data-row-id], [data-command="group-back"]')?.focus({preventScroll:true});
      }
    }catch(error){toast(error.message,true);}
    return;
  }
  if(button?.dataset.deleteGroup){deleteDialog('action',button.dataset.deleteGroup);return;}
  if(button?.dataset.deleteAction){deleteDialog('action',button.dataset.deleteAction);return;}
  if(button?.dataset.moveId){const next=structuredClone(state),old=state;state=next;const found=locate(button.dataset.moveId),newIndex=found.index+Number(button.dataset.direction);if(newIndex>=0&&newIndex<found.items.length)[found.items[found.index],found.items[newIndex]]=[found.items[newIndex],found.items[found.index]];state=old;await save(next);return;}
  if(button?.dataset.toggle){const key=button.dataset.toggle;const current=key==='closeOnOutsideClick'?state[key]!==false:state[key];await change({[key]:!current});return;}
  if(button?.dataset.themeValue){await change({theme:button.dataset.themeValue});return;}
  const command=button?.dataset.command;
  if(command){await runCommand(command);return;}
  const row=event.target.closest('[data-row-id]');if(row&&!overlay){await activateEditorItem(row.dataset.rowId);return;}
  const sector=event.target.closest('[data-sector]');if(sector&&!overlay){await activateEditorItem(sector.dataset.sector);}
});
async function runCommand(command){
  try{
    switch(command){
      case 'minimize':await api.minimize();break;
      case 'maximize':await api.maximize();break;
      case 'close-window':await api.closeWindow();break;
      case 'toggle-theme':await change({theme:document.documentElement.dataset.theme==='dark'?'light':'dark'});break;
      case 'preview':await api.showWheel();break;
      case 'check-updates':updateStatus=await api.checkForUpdates();refreshUpdates(updateStatus);break;
      case 'download-update':updateStatus=await api.downloadUpdate();refreshUpdates(updateStatus);break;
      case 'install-update':updateStatus=await api.installUpdate();refreshUpdates(updateStatus);break;
      case 'open-update-repository':await api.openUpdateRepository();break;
      case 'reset-wheel-size':await change({wheelSize:520});document.querySelector('#wheel-size')?.focus({preventScroll:true});break;
      case 'new-menu':menuDialog();break;
      case 'rename-menu':menuDialog('rename');break;
      case 'delete-menu':deleteDialog('menu');break;
      case 'duplicate-menu':{if(state.menus.length>=20){toast('Можна створити до 20 меню.',true);break;}const copy=structuredClone(currentMenu());copy.id=uuid();copy.name+=' — копія';const renew=items=>items.forEach(i=>{i.id=uuid();if(i.children)renew(i.children);});renew(copy.items);groupPath=[];await change({menus:[...state.menus,copy],activeMenuId:copy.id},'Меню продубльовано');break;}
      case 'add-action':actionDialog();break;
      case 'group-back':groupPath.pop();render();break;
      case 'export':{const result=await api.exportState();if(result.ok)toast('Налаштування експортовано');else if(result.error)toast(result.error,true);break;}
      case 'import':modal('Імпортувати налаштування?',`<div class="modal-body"><p class="delete-copy">Поточні меню та налаштування буде замінено даними з обраного файлу. Імпорт самостійно не запускає жодних дій.</p></div>`,`<button class="btn" data-command="dismiss">Скасувати</button><button class="btn primary" id="confirm-import">Вибрати JSON-файл</button>`);document.querySelector('#confirm-import').onclick=async()=>{try{const result=await api.importState();if(result){state=result;groupPath=[];closeModal();applyTheme();render();toast('Налаштування імпортовано');}}catch(error){toast(error.message,true);}};break;
    }
  }catch(error){toast(error.message,true);}
}
root.addEventListener('change',async event=>{
  const key=event.target.dataset.preference;if(!key)return;
  if(key==='wheelSize'){
    const restoreFocus=document.activeElement===event.target;
    await change({wheelSize:Math.round(Number(event.target.value)*520/100)});
    if(restoreFocus)document.querySelector('#wheel-size')?.focus({preventScroll:true});
  }else change({[key]:['triggerButton','hoverDelay'].includes(key)?Number(event.target.value):event.target.value});
});
root.addEventListener('input',event=>{
  if(event.target.id==='wheel-size'){
    const percent=Number(event.target.value);
    document.querySelector('#wheel-size-value').value=percent+'%';
    event.target.setAttribute('aria-valuetext',percent+'%');
    event.target.style.setProperty('--range-progress',(percent-60)/90*100+'%');
  }
  if(event.target.id==='action-search'){const caret=event.target.selectionStart;search=event.target.value;render();const input=document.querySelector('#action-search');input.focus();input.setSelectionRange(caret,caret);}
});
document.querySelector('#modal-root').addEventListener('click',event=>{if(event.target.classList.contains('modal-backdrop')||event.target.closest('[data-command="dismiss"]'))closeModal();});
document.addEventListener('keydown',event=>{
  if(document.querySelector('select:open'))return;
  const dialog=document.querySelector('.modal');
  if(dialog){if(event.key==='Escape'){event.preventDefault();closeModal();}if(event.key==='Tab'){const focusable=[...dialog.querySelectorAll('button:not(:disabled),input,select,textarea')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}return;}
  if(overlay){if(event.key==='Escape'){clearWheelTimers();wheelOpen=false;api.closeWheel();}else if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)){event.preventDefault();const items=wheelItems();if(items.length)selectWheel((wheelSelected+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+items.length)%items.length,true);}else if(event.key==='Enter'){event.preventDefault();commitWheel();}else if(event.key==='Backspace'){event.preventDefault();wheelBack();}return;}
  if(event.key==='Enter'&&event.target.matches('[data-row-id]')){event.preventDefault();activateEditorItem(event.target.dataset.rowId);}
});

function wheelItems(){return wheelStack.length?wheelStack.at(-1).children:currentMenu().items;}
function clearWheelTimers(){clearTimeout(wheelTimer);clearTimeout(groupTimer);wheelTimer=null;groupTimer=null;}
function drawOverlay(animate=false){
  const group=wheelStack.at(-1);renderWheel(document.querySelector('#overlay-wheel-content'),wheelItems(),{title:group?group.name:'Orbit',selected:wheelItems()[wheelSelected]?.id,back:!!group});
  hydrateAppIcons(document.querySelector('#overlay-wheel'));
  if(animate&&!state.reducedMotion){const w=document.querySelector('.wheel');w.classList.add('wheel-appear');}
}
function selectWheel(index,keyboard=false){
  if(index===wheelSelected)return;clearWheelTimers();wheelSelected=index;
  const items=wheelItems(),selected=items[index];
  document.querySelectorAll('[data-sector]').forEach(node=>node.classList.toggle('selected',node.dataset.sector===selected?.id));
  document.querySelectorAll('[data-wheel-id]').forEach(node=>node.classList.toggle('selected',node.dataset.wheelId===selected?.id));
  if(!selected||keyboard||wheelBusy)return;
  if(selected.kind==='group'){if(state.groupOpenMode!=='click')groupTimer=setTimeout(()=>openWheelGroup(selected),300);}
  else if(state.activationMode==='hover'&&wheelTrigger==='mouse')wheelTimer=setTimeout(()=>commitWheel(),state.hoverDelay);
}
function openWheelGroup(item){
  if(!wheelOpen||wheelBusy)return;clearWheelTimers();wheelStack.push(item);wheelSelected=-1;transitionOrigin=mousePoint?{...mousePoint}:null;drawOverlay();
}
function wheelBack(){if(!wheelStack.length)return;clearWheelTimers();wheelStack.pop();wheelSelected=-1;transitionOrigin=mousePoint?{...mousePoint}:null;drawOverlay();}
async function commitWheel(){
  const item=wheelItems()[wheelSelected];if(!item||wheelBusy||!wheelOpen)return;if(item.kind==='group'){openWheelGroup(item);return;}
  clearWheelTimers();wheelBusy=true;wheelOpen=false;
  try{await api.closeWheel();const result=await api.executeAction(item);if(!result.ok){toast(result.error||'Не вдалося виконати дію',true);}}catch(error){toast(error.message,true);}finally{wheelBusy=false;}
}
function initOverlay(){
  document.body.classList.add('overlay');root.innerHTML='<div class="overlay-wheel" id="overlay-wheel"><div class="overlay-wheel-content" id="overlay-wheel-content"></div></div>';
  api.onWheelOpen(payload=>{clearWheelTimers();wheelTrigger=payload.trigger;wheelStack=[];wheelSelected=-1;wheelBusy=false;wheelOpen=true;mousePoint=null;transitionOrigin=null;const center=payload.center||{x:innerWidth/2,y:innerHeight/2};const mount=document.querySelector('#overlay-wheel');const size=payload.size??Math.min(state.wheelSize??520,innerWidth-30,innerHeight-60);mount.style.width=size+'px';mount.style.height=size+'px';mount.style.setProperty('--wheel-scale',size/520);mount.style.left=(center.x-size/2)+'px';mount.style.top=(center.y-size/2)+'px';drawOverlay(true);});
  api.onWheelClosed?.(()=>{clearWheelTimers();wheelOpen=false;wheelSelected=-1;});
  api.onTriggerRelease(()=>{if(!wheelOpen||wheelTrigger!=='mouse'||state.activationMode!=='release')return;if(wheelSelected>=0&&wheelItems()[wheelSelected]?.kind!=='group')commitWheel();else if(!wheelStack.length){clearWheelTimers();wheelOpen=false;api.closeWheel();}});
  root.addEventListener('pointerdown',event=>{
    if(!wheelOpen||state.closeOnOutsideClick===false||![0,1,2].includes(event.button))return;
    const bounds=document.querySelector('#overlay-wheel').getBoundingClientRect();
    const distance=Math.hypot(event.clientX-bounds.left-bounds.width/2,event.clientY-bounds.top-bounds.height/2);
    if(distance>207*bounds.width/480){clearWheelTimers();wheelOpen=false;api.closeWheel();}
  });
  root.addEventListener('pointermove',event=>{
    if(!wheelOpen||wheelBusy)return;mousePoint={x:event.clientX,y:event.clientY};
    if(transitionOrigin&&Math.hypot(mousePoint.x-transitionOrigin.x,mousePoint.y-transitionOrigin.y)<12)return;transitionOrigin=null;
    const bounds=document.querySelector('#overlay-wheel').getBoundingClientRect(),scale=bounds.width/480;
    selectWheel(sectorAt((event.clientX-bounds.left-bounds.width/2)/scale,(event.clientY-bounds.top-bounds.height/2)/scale,wheelItems().length,88,225));
  });
  root.addEventListener('click',event=>{const itemButton=event.target.closest('[data-wheel-id]'),sector=event.target.closest('[data-sector]');if(event.target.closest('[data-wheel-back]')){wheelBack();return;}if(itemButton||sector){const id=itemButton?.dataset.wheelId||sector.dataset.sector;wheelSelected=wheelItems().findIndex(i=>i.id===id);commitWheel();}});
}

async function init(){
  if(!api){root.innerHTML='<div class="empty-state"><h1>Orbit</h1><p>Відкрийте застосунок через Orbit.exe або npm start.</p></div>';return;}
  state=await api.getState();runtime=await api.getRuntime();updateStatus=await api.getUpdateStatus();applyTheme();
  api.onUpdateStatus(next=>{updateStatus=next;if(!overlay)refreshUpdates(next);});
  api.onStateChanged(next=>{state=next;applyTheme();if(!overlay)render();else if(wheelOpen){clearWheelTimers();wheelStack=[];wheelSelected=-1;drawOverlay();}});
  api.onRuntimeChanged(next=>{runtime=next;if(!overlay)render();});
  api.onNavigate(next=>{if(['menus','library','controls','settings'].includes(next)){page=next;render();}});
  api.onActionError?.(({error,actionId})=>{if(!overlay){selectedId=actionId;render();toast(error,true);}});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.theme==='system'){applyTheme();if(!overlay)render();}});
  if(overlay)initOverlay();else render();
  document.documentElement.dataset.ready='true';
}
init().catch(error=>{root.innerHTML=`<div class="empty-state"><h1>Orbit</h1><p>${e(error.message)}</p></div>`;console.error(error);});
