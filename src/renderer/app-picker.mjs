import {icon,itemIcon,rememberAppIcon,hydrateAppIcons} from './icons.mjs';
import {escapeHTML as e} from './wheel.mjs';

export function appPickerFields(draft,config){
  const urlMode=config.mode==='url';
  const actions=`<div class="app-manual-actions">${urlMode?`<button class="btn small ghost" type="button" data-app-mode="search">${icon('search',13)}Знайти програму</button>`:`<button class="btn small ghost" type="button" id="browse-target">${icon('folder',13)}Обрати файл…</button><button class="btn small ghost" type="button" data-app-mode="url">${icon('external',13)}Вказати URL</button>`}</div>`;
  const primary=urlMode?`<div class="field"><div class="app-search-heading"><label for="action-target">Посилання</label>${actions}</div><input id="action-target" name="target" type="url" value="${e(draft.target)}" placeholder="https://example.com" autocomplete="off"><small>Відкриється у вашому браузері.</small></div>`:`<div class="field app-search-field"><div class="app-search-heading"><label for="app-search">Знайти застосунок</label>${actions}</div><div class="app-search-input">${icon('search',16)}<input id="app-search" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="app-results" autocomplete="off" spellcheck="false" placeholder="Наприклад, Illustrator" value="${e(config.query||'')}"><button class="icon-btn" id="refresh-apps" type="button" aria-label="Оновити список застосунків" title="Оновити список">${icon('refresh',15)}</button></div><div id="app-results" class="app-results" popover="manual" role="listbox" aria-label="Встановлені застосунки"></div></div>`;
  return `${primary}
    ${!urlMode&&draft.target?`<div class="selected-app" id="selected-app">${itemIcon({...draft,name:config.selectedName||draft.name},27)}<div><strong>${e(config.selectedName||draft.name||'Обраний застосунок')}</strong><small title="${e(draft.target)}">${e(draft.target.startsWith('app-id:')?'Застосунок Windows':draft.target)}</small></div>${icon('check',15)}</div>`:'<div id="selected-app" hidden></div>'}
    <div class="field"><label for="action-name">Назва в колесі</label><input id="action-name" name="name" maxlength="100" value="${e(draft.name)}" placeholder="Заповниться після вибору програми"></div>
    ${!urlMode?`<details class="app-advanced" ${config.detailsOpen?'open':''}><summary>${icon('chevron',13)}Додатково</summary><div class="field"><label for="action-target">Програма, ярлик або URL</label><input id="action-target" name="target" value="${e(draft.target)}" placeholder="C:\\Program Files\\…\\App.exe" autocomplete="off"></div><div class="field"><label for="action-args">Аргументи <span class="optional-label">· необов’язково</span></label><input id="action-args" name="args" value="${e(draft.args)}" placeholder='Наприклад, "C:\\Projects\\scene.aep"' ${draft.target.startsWith('app-id:')?'disabled':''}><small>${draft.target.startsWith('app-id:')?'Цей застосунок запускається без додаткових аргументів.':'Для .exe можна вказати аргументи. Аргументи ярлика налаштовуються у його властивостях.'}</small></div></details>`:''}`;
}

export function mountAppPicker({form,draft,config,onChoose,onModeChange,onPickedChange=()=>{}}){
  const controller=new AbortController(),{signal}=controller;
  const api=window.orbit,input=form.querySelector('#app-search'),panel=form.querySelector('#app-results');
  let generation=0,timer,results=[],active=-1,disposed=false,displayedQuery='';
  const close=()=>{clearTimeout(timer);timer=null;generation++;if(panel?.matches(':popover-open'))panel.hidePopover();input?.setAttribute('aria-expanded','false');input?.removeAttribute('aria-activedescendant');};
  const show=()=>{if(!panel?.isConnected||disposed)return;if(!panel.matches(':popover-open'))panel.showPopover();input.setAttribute('aria-expanded','true');};
  const choose=index=>{const entry=results[index];if(!entry||displayedQuery!==input.value.trim())return;rememberAppIcon(entry.target,entry.icon);close();onChoose(entry);};
  // Ticked programs survive new searches and are added together by the dialog's main button.
  const toggle=index=>{
    const entry=results[index];if(!entry||!config.picked)return;
    if(config.picked.has(entry.target))config.picked.delete(entry.target);else config.picked.set(entry.target,entry);
    const node=panel.querySelector(`#app-result-${index}`);node?.classList.toggle('picked',config.picked.has(entry.target));node?.setAttribute('aria-checked',String(config.picked.has(entry.target)));
    onPickedChange(config.picked.size);
  };
  const activate=(index,event)=>config.picked&&(config.picked.size||event?.ctrlKey||event?.target?.closest?.('.app-result-check'))?toggle(index):choose(index);
  const highlight=index=>{if(!results.length)return;active=(index+results.length)%results.length;panel.querySelectorAll('[role="option"]').forEach((node,i)=>node.setAttribute('aria-selected',String(i===active)));input.setAttribute('aria-activedescendant',`app-result-${active}`);panel.querySelector(`#app-result-${active}`)?.scrollIntoView({block:'nearest'});};
  async function search(refresh=false){
    if(!input?.isConnected||disposed)return;
    const request=++generation,query=input.value.trim();config.query=input.value;
    if(!results.length){panel.innerHTML='<div class="app-search-status" role="status">Шукаємо встановлені програми…</div>';show();}
    try{
      const response=await api.searchApps(query,refresh);
      if(request!==generation||!input.isConnected||disposed)return;
      results=response.apps||[];active=-1;displayedQuery=query;
      for(const entry of results)rememberAppIcon(entry.target,entry.icon);
      const picked=entry=>config.picked?.has(entry.target);
      panel.innerHTML=results.length?`<div class="app-results-label">${query?'Результати пошуку':'Встановлені застосунки'}${config.picked?' · позначте кілька, щоб додати разом':''}</div>${results.map((entry,i)=>`<button type="button" class="app-result ${picked(entry)?'picked':''}" role="option" tabindex="-1" id="app-result-${i}" data-result="${i}" aria-selected="false" ${config.picked?`aria-checked="${!!picked(entry)}"`:''}><span class="app-result-icon">${itemIcon({kind:'app',name:entry.name,target:entry.target,icon:'app'},26)}</span><span class="app-result-copy"><strong>${e(entry.name)}</strong><small title="${e(entry.target)}">${e(entry.target.startsWith('app-id:')?'Застосунок Windows':entry.target)}</small></span>${config.picked?`<span class="app-result-check" title="Позначити">${icon('check',13)}</span>`:''}</button>`).join('')}`:`<div class="app-search-status" role="status">${response.error?'Не вдалося отримати список програм. Скористайтеся кнопкою «Обрати файл…».':query?'Нічого не знайдено. Спробуйте іншу назву або оберіть файл.':'Програм не знайдено. Оберіть файл або оновіть список.'}</div>`;
      show();hydrateAppIcons(panel);
    }catch{
      if(request===generation&&input.isConnected&&!disposed){results=[];panel.innerHTML='<div class="app-search-status" role="status">Пошук недоступний. Оберіть файл або натисніть «Оновити список».</div>';show();}
    }
  }
  if(input){
    input.addEventListener('input',()=>{
      config.query=input.value;
      if(draft.target){const name=form.querySelector('#action-name');if(name.value===config.selectedName){name.value='';draft.name='';}draft.target='';form.querySelector('#action-target').value='';const selected=form.querySelector('#selected-app');selected.hidden=true;}
      clearTimeout(timer);generation++;results=[];active=-1;panel.innerHTML='<div class="app-search-status" role="status">Пошук…</div>';show();timer=setTimeout(()=>search(),120);
    },{signal});
    input.addEventListener('focus',()=>search(),{signal});
    input.addEventListener('blur',()=>queueMicrotask(()=>{if(!document.activeElement?.closest('.app-search-field')){generation++;close();}}),{signal});
    input.addEventListener('keydown',event=>{
      const open=panel.matches(':popover-open');
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();event.stopPropagation();
        if(!open){search();return;}
        highlight(active<0?(event.key==='ArrowDown'?0:results.length-1):active+(event.key==='ArrowDown'?1:-1));
      }else if(event.key==='Enter'&&open){event.preventDefault();event.stopPropagation();activate(active<0?0:active,event);}
      else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();generation++;close();}
      else if(event.key==='Tab'){generation++;close();}
    },{signal});
    panel.addEventListener('pointerdown',event=>{if(event.target.closest('[data-result]'))event.preventDefault();},{signal});
    panel.addEventListener('click',event=>{const button=event.target.closest('[data-result]');if(button)activate(Number(button.dataset.result),event);},{signal});
    form.querySelector('#refresh-apps').addEventListener('click',()=>{input.focus();search(true);},{signal});
    document.addEventListener('pointerdown',event=>{if(!event.target.closest('.app-search-field')){generation++;close();}},{capture:true,signal});
  }
  form.querySelectorAll('[data-app-mode]').forEach(button=>button.addEventListener('click',()=>{close();onModeChange(button.dataset.appMode);},{signal}));
  form.querySelector('#browse-target')?.addEventListener('click',close,{signal});
  form.querySelector('.app-advanced')?.addEventListener('toggle',event=>{config.detailsOpen=event.target.open;},{signal});
  hydrateAppIcons(form);
  return ()=>{disposed=true;generation++;clearTimeout(timer);close();controller.abort();};
}
