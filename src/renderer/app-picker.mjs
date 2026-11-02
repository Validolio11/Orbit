import {icon,itemIcon,rememberAppIcon,hydrateAppIcons} from './icons.mjs';
import {escapeHTML as e} from './wheel.mjs';

// Matches the four-column .app-grid layout, so arrow keys move by whole rows.
const COLUMNS=4;

export function appPickerFields(draft,config){
  const urlMode=config.mode==='url',adding=!!config.picked;
  const actions=`<div class="app-manual-actions">${urlMode?`<button class="btn small ghost" type="button" data-app-mode="search">${icon('search',13)}Знайти програму</button>`:`<button class="btn small ghost" type="button" id="browse-target">${icon('folder',13)}Обрати файл…</button><button class="btn small ghost" type="button" data-app-mode="url">${icon('external',13)}Вказати URL</button>`}</div>`;
  const nameField=`<div class="field"><label for="action-name">Назва в колесі</label><input id="action-name" name="name" maxlength="100" value="${e(draft.name)}" placeholder="${urlMode?'Наприклад, Пошта':'Заповниться після вибору програми'}"></div>`;
  const primary=urlMode?`<div class="field"><div class="app-search-heading"><label for="action-target">Посилання</label>${actions}</div><input id="action-target" name="target" type="url" value="${e(draft.target)}" placeholder="https://example.com" autocomplete="off"><small>Відкриється у вашому браузері.</small></div>`:`<div class="field app-search-field"><div class="app-search-heading"><label for="app-search">${adding?'Виберіть програму':'Замінити програму'}</label>${actions}</div><div class="app-search-input">${icon('search',16)}<input id="app-search" type="search" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="app-results" autocomplete="off" spellcheck="false" placeholder="Пошук серед встановлених програм" value="${e(config.query||'')}"><button class="icon-btn" id="refresh-apps" type="button" aria-label="Оновити список застосунків" title="Оновити список">${icon('refresh',15)}</button></div><div id="app-results" class="app-grid" role="listbox" aria-label="Встановлені застосунки" ${adding?'aria-multiselectable="true"':''}></div>${adding?'<small class="app-grid-hint">Клацніть програму, щоб додати її. Позначте галочкою кілька, щоб додати разом (з клавіатури — Ctrl+Enter).</small>':''}</div>`;
  // While adding, a click adds the program at once, so the name is only edited under "Додатково".
  return `${primary}
    ${!urlMode&&draft.target&&!adding?`<div class="selected-app" id="selected-app">${itemIcon({...draft,name:config.selectedName||draft.name},27)}<div><strong>${e(config.selectedName||draft.name||'Обраний застосунок')}</strong><small title="${e(draft.target)}">${e(draft.target.startsWith('app-id:')?'Застосунок Windows':draft.target)}</small></div>${icon('check',15)}</div>`:'<div id="selected-app" hidden></div>'}
    ${urlMode||!adding?nameField:''}
    ${!urlMode?`<details class="app-advanced" ${config.detailsOpen?'open':''}><summary>${icon('chevron',13)}Додатково</summary>${adding?nameField:''}<div class="field"><label for="action-target">Програма, ярлик або URL</label><input id="action-target" name="target" value="${e(draft.target)}" placeholder="C:\\Program Files\\…\\App.exe" autocomplete="off"></div><div class="field"><label for="action-args">Аргументи <span class="optional-label">· необов’язково</span></label><input id="action-args" name="args" value="${e(draft.args)}" placeholder='Наприклад, "C:\\Projects\\scene.aep"' ${draft.target.startsWith('app-id:')?'disabled':''}><small>${draft.target.startsWith('app-id:')?'Цей застосунок запускається без додаткових аргументів.':'Для .exe можна вказати аргументи. Аргументи ярлика налаштовуються у його властивостях.'}</small></div></details>`:''}`;
}

export function mountAppPicker({form,draft,config,onChoose,onModeChange,onPickedChange=()=>{}}){
  const controller=new AbortController(),{signal}=controller;
  const api=window.orbit,input=form.querySelector('#app-search'),grid=form.querySelector('#app-results');
  let generation=0,timer,results=[],active=-1,disposed=false,displayedQuery='';
  const status=text=>{grid.innerHTML=`<div class="app-search-status" role="status">${text}</div>`;};
  const choose=index=>{const entry=results[index];if(!entry||displayedQuery!==input.value.trim())return;rememberAppIcon(entry.target,entry.icon);onChoose(entry);};
  // Ticked programs survive new searches and are added together by the dialog's main button.
  const toggle=index=>{
    const entry=results[index];if(!entry||!config.picked)return;
    if(config.picked.has(entry.target))config.picked.delete(entry.target);else config.picked.set(entry.target,entry);
    const node=grid.querySelector(`#app-result-${index}`);node?.classList.toggle('picked',config.picked.has(entry.target));node?.setAttribute('aria-selected',String(config.picked.has(entry.target)));
    onPickedChange(config.picked.size);
  };
  const activate=(index,event)=>config.picked&&(config.picked.size||event?.ctrlKey||event?.target?.closest?.('.app-result-check'))?toggle(index):choose(index);
  const highlight=index=>{
    if(!results.length)return;active=Math.max(0,Math.min(results.length-1,index));
    grid.querySelectorAll('[role="option"]').forEach((node,i)=>node.classList.toggle('is-active',i===active));
    input.setAttribute('aria-activedescendant',`app-result-${active}`);grid.querySelector(`#app-result-${active}`)?.scrollIntoView({block:'nearest'});
  };
  async function search(refresh=false){
    if(!input?.isConnected||disposed)return;
    const request=++generation,query=input.value.trim();config.query=input.value;
    if(!results.length)status('Шукаємо встановлені програми…');
    try{
      const response=await api.searchApps(query,refresh,{limit:60,icons:false});
      if(request!==generation||!input.isConnected||disposed)return;
      results=response.apps||[];active=-1;displayedQuery=query;input.removeAttribute('aria-activedescendant');
      const picked=entry=>config.picked?.has(entry.target);
      if(!results.length){status(response.error?'Не вдалося отримати список програм. Скористайтеся кнопкою «Обрати файл…».':query?'Нічого не знайдено. Спробуйте іншу назву або оберіть файл.':'Програм не знайдено. Оберіть файл або оновіть список.');return;}
      grid.innerHTML=results.map((entry,i)=>`<button type="button" class="app-result ${picked(entry)?'picked':''}" role="option" tabindex="-1" id="app-result-${i}" data-result="${i}" aria-selected="${!!picked(entry)}" title="${e(entry.name)}&#10;${e(entry.target.startsWith('app-id:')?'Застосунок Windows':entry.target)}"><span class="app-result-icon">${itemIcon({kind:'app',name:entry.name,target:entry.target,icon:'app'},34)}</span><span class="app-result-copy"><strong>${e(entry.name)}</strong></span>${config.picked?`<span class="app-result-check" title="Позначити">${icon('check',12)}</span>`:''}</button>`).join('');
      hydrateAppIcons(grid);
    }catch{
      if(request===generation&&input.isConnected&&!disposed){results=[];status('Пошук недоступний. Оберіть файл або натисніть «Оновити список».');}
    }
  }
  if(input){
    input.addEventListener('input',()=>{
      config.query=input.value;
      if(draft.target&&!config.picked){const name=form.querySelector('#action-name');if(name&&name.value===config.selectedName){name.value='';draft.name='';}draft.target='';form.querySelector('#action-target').value='';const selected=form.querySelector('#selected-app');selected.hidden=true;}
      clearTimeout(timer);generation++;timer=setTimeout(()=>search(),120);
    },{signal});
    input.addEventListener('keydown',event=>{
      const step={ArrowRight:1,ArrowLeft:-1,ArrowDown:COLUMNS,ArrowUp:-COLUMNS}[event.key];
      if(step&&results.length&&(active>=0||event.key==='ArrowDown')){event.preventDefault();event.stopPropagation();highlight(active<0?0:active+step);}
      else if(event.key==='Enter'&&(active>=0||input.value.trim())){
        event.preventDefault();event.stopPropagation();
        // Typing faster than the search: run it now, then take the first match.
        if(displayedQuery!==input.value.trim()){clearTimeout(timer);const ctrlKey=event.ctrlKey;search().then(()=>{if(results.length)activate(0,{ctrlKey});});return;}
        if(results.length)activate(active<0?0:active,event);
      }
      // Escape first drops the highlight, then clears the query; only an empty search lets it close the dialog.
      else if(event.key==='Escape'&&active>=0){event.preventDefault();event.stopPropagation();active=-1;grid.querySelectorAll('[role="option"]').forEach(node=>node.classList.remove('is-active'));input.removeAttribute('aria-activedescendant');}
      else if(event.key==='Escape'&&input.value){event.preventDefault();event.stopPropagation();input.value='';input.dispatchEvent(new Event('input'));}
    },{signal});
    grid.addEventListener('pointerdown',event=>{if(event.target.closest('[data-result]'))event.preventDefault();},{signal});
    grid.addEventListener('click',event=>{const button=event.target.closest('[data-result]');if(button)activate(Number(button.dataset.result),event);},{signal});
    form.querySelector('#refresh-apps').addEventListener('click',()=>{input.focus();search(true);},{signal});
    search();
  }
  form.querySelectorAll('[data-app-mode]').forEach(button=>button.addEventListener('click',()=>onModeChange(button.dataset.appMode),{signal}));
  form.querySelector('.app-advanced')?.addEventListener('toggle',event=>{config.detailsOpen=event.target.open;},{signal});
  hydrateAppIcons(form);
  return ()=>{disposed=true;generation++;clearTimeout(timer);controller.abort();};
}
