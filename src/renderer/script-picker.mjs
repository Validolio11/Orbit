import {icon} from './icons.mjs';
import {escapeHTML as e} from './wheel.mjs';

const TYPES={'.ps1':'PS1','.py':'PY','.js':'JS','.cjs':'JS'};

// A script's wheel name is its file name without the extension unless the user types another one.
export function scriptName(target){
  const file=String(target||'').split(/[\\/]/).pop()||'';
  return file.replace(/\.[^.]+$/,'')||file;
}

export function scriptPickerFields(draft,config){
  const adding=!!config.picked;
  const pathField=`<div class="field"><label for="action-target">Файл скрипту</label><div class="field-inline"><input id="action-target" name="target" value="${e(draft.target)}" placeholder="C:\\Scripts\\render.ps1" autocomplete="off"><button class="btn" type="button" id="browse-target">Огляд…</button></div></div>`;
  const nameField=`<div class="field"><label for="action-name">Назва в колесі</label><input id="action-name" name="name" maxlength="100" value="${e(draft.name)}" placeholder="Візьметься з назви файлу"></div>`;
  const argsField=`<div class="field"><label for="action-args">Аргументи <span class="optional-label">· необов’язково</span></label><input id="action-args" name="args" value="${e(draft.args)}" placeholder='Наприклад, "C:\\Projects\\scene.aep"'><small>Аргументи з пробілами беріть у подвійні лапки.</small></div>`;
  if(!adding)return `${nameField}${pathField}${argsField}<small class="field-note">Підтримуються .ps1, .py, .js та .cjs.</small>`;
  return `<div class="field app-search-field"><div class="app-search-heading"><label for="script-search">Виберіть скрипт</label><div class="app-manual-actions"><button class="btn small ghost" type="button" id="browse-script">${icon('script',13)}Обрати файл…</button></div></div>
    <div class="app-search-input">${icon('search',16)}<input id="script-search" type="search" autocomplete="off" spellcheck="false" placeholder="Пошук за назвою або папкою"></div>
    <div id="script-results" class="app-grid script-grid" role="listbox" aria-label="Знайдені скрипти" aria-multiselectable="true"><div class="app-search-status" role="status">Шукаємо скрипти…</div></div>
    <small class="app-grid-hint" id="script-hint">Клацніть скрипт, щоб додати його, або позначте кілька галочкою (Пробіл). Шукаємо .ps1, .py, .js і .cjs на робочому столі, у Документах, Завантаженнях і папках ваших скриптів.</small></div>
    <details class="app-advanced" ${config.detailsOpen?'open':''}><summary>${icon('chevron',13)}Аргументи та шлях вручну</summary>${pathField}${nameField}${argsField}</details>`;
}

export function mountScriptPicker({form,config,onChoose,onPickedChange=()=>{}}){
  const grid=form.querySelector('#script-results'),input=form.querySelector('#script-search');
  let scripts=[],python=true,disposed=false;
  if(!grid)return ()=>{};
  const visible=()=>{const query=input.value.trim().toLowerCase();return scripts.map((entry,index)=>({entry,index})).filter(({entry})=>!query||entry.name.toLowerCase().includes(query)||entry.folder.toLowerCase().includes(query));};
  function draw(){
    const rows=visible();
    if(!scripts.length){grid.innerHTML=`<div class="script-empty" role="status">${icon('script',28)}<strong>Скриптів поки не знайдено</strong><p>Оберіть файл .ps1, .py, .js або .cjs чи перетягніть його у вікно Orbit.</p><button type="button" class="btn" data-browse-script>${icon('folder',14)}Обрати файл…</button></div>`;return;}
    if(!rows.length){grid.innerHTML='<div class="app-search-status" role="status">Нічого не знайдено. Спробуйте іншу назву або оберіть файл.</div>';return;}
    grid.innerHTML=rows.map(({entry,index})=>{
      const picked=config.picked.has(entry.target),missing=entry.extension==='.py'&&!python;
      return `<button type="button" class="app-result script-result ${picked?'picked':''} ${missing?'unavailable':''}" role="option" data-script="${index}" aria-selected="${picked}" title="${e(entry.target)}${missing?'&#10;Потрібен Python Launcher (py.exe)':''}"><span class="app-result-icon">${icon('script',26)}<i class="script-type">${TYPES[entry.extension]||''}</i></span><span class="app-result-copy"><strong>${e(entry.name)}</strong><small>${e(missing?'Немає Python':entry.folder)}</small></span><span class="app-result-check" title="Позначити">${icon('check',12)}</span></button>`;
    }).join('');
  }
  const toggle=index=>{
    const entry=scripts[index];if(!entry)return;
    if(config.picked.has(entry.target))config.picked.delete(entry.target);else config.picked.set(entry.target,entry);
    const node=grid.querySelector(`[data-script="${index}"]`);node?.classList.toggle('picked',config.picked.has(entry.target));node?.setAttribute('aria-selected',String(config.picked.has(entry.target)));
    onPickedChange(config.picked.size);
  };
  window.orbit.listScripts().then(result=>{
    if(disposed)return;
    python=result?.python!==false;
    scripts=(result?.scripts||[]).map(row=>({kind:'script',name:row.name,target:row.path,args:'',extension:row.extension,folder:row.folder}));
    if(!python&&scripts.some(entry=>entry.extension==='.py'))form.querySelector('#script-hint')?.insertAdjacentHTML('beforeend',' Python Launcher не знайдено, тож .py-скрипти не запустяться, доки ви його не встановите.');
    draw();
  }).catch(()=>{if(!disposed)grid.innerHTML='<div class="app-search-status" role="status">Не вдалося знайти скрипти. Скористайтеся кнопкою «Обрати файл…».</div>';});
  input.addEventListener('input',draw);
  input.addEventListener('keydown',event=>{
    // Enter adds the first match; Escape clears the filter before it can close the dialog.
    if(event.key==='Enter'){event.preventDefault();event.stopPropagation();const first=visible()[0];if(first)onChoose(first.entry);}
    else if(event.key==='Escape'&&input.value){event.preventDefault();event.stopPropagation();input.value='';draw();}
  });
  grid.addEventListener('keydown',event=>{const button=event.target.closest('[data-script]');if(event.key===' '&&button){event.preventDefault();toggle(Number(button.dataset.script));}});
  grid.addEventListener('keyup',event=>{if(event.key===' '&&event.target.closest('[data-script]'))event.preventDefault();});
  grid.addEventListener('click',event=>{
    if(event.target.closest('[data-browse-script]')){form.querySelector('#browse-script')?.click();return;}
    const button=event.target.closest('[data-script]');if(!button)return;
    const index=Number(button.dataset.script);
    if(config.picked.size||event.ctrlKey||event.target.closest('.app-result-check'))toggle(index);else onChoose(scripts[index]);
  });
  return ()=>{disposed=true;};
}
