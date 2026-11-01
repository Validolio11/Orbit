import {icon} from './icons.mjs';
import {escapeHTML as e} from './wheel.mjs';

const GROUPS={quick:'Швидкий доступ',known:'Стандартні папки',drive:'Диски'};

// The folder name in the wheel comes from the folder itself unless the user types another one.
export function folderName(target){
  const trimmed=String(target||'').replace(/[\\/]+$/,'');
  return trimmed.split(/[\\/]/).pop()||trimmed;
}

export function folderPickerFields(draft,config){
  const adding=!!config.picked;
  const pathField=`<div class="field"><label for="action-target">Шлях до папки</label><div class="field-inline"><input id="action-target" name="target" value="${e(draft.target)}" placeholder="C:\\Проєкти" autocomplete="off"><button class="btn" type="button" id="browse-target">Огляд…</button></div></div>`;
  const nameField=`<div class="field"><label for="action-name">Назва в колесі</label><input id="action-name" name="name" maxlength="100" value="${e(draft.name)}" placeholder="Візьметься з назви папки"></div>`;
  if(!adding)return `${nameField}${pathField}<small class="field-note">Відкриється у Провіднику Windows.</small>`;
  return `<div class="field app-search-field"><div class="app-search-heading"><span class="field-title" id="folder-title">Виберіть папку</span><div class="app-manual-actions"><button class="btn small ghost" type="button" id="browse-folder">${icon('folder',13)}Обрати папку…</button></div></div>
    <div id="folder-results" class="app-grid folder-grid" role="listbox" aria-labelledby="folder-title" aria-multiselectable="true"><div class="app-search-status" role="status">Шукаємо папки…</div></div>
    <small class="app-grid-hint">Клацніть папку, щоб додати її. Позначте кілька галочкою або перетягніть папку з Провідника у вікно Orbit.</small></div>
    <details class="app-advanced" ${config.detailsOpen?'open':''}><summary>${icon('chevron',13)}Вказати шлях вручну</summary>${pathField}${nameField}</details>`;
}

export function mountFolderPicker({form,config,onChoose,onPickedChange=()=>{}}){
  const grid=form.querySelector('#folder-results');
  let folders=[],disposed=false;
  if(!grid)return ()=>{};
  const toggle=index=>{
    const entry=folders[index];if(!entry)return;
    if(config.picked.has(entry.target))config.picked.delete(entry.target);else config.picked.set(entry.target,entry);
    const node=grid.querySelector(`[data-folder="${index}"]`);node?.classList.toggle('picked',config.picked.has(entry.target));node?.setAttribute('aria-checked',String(config.picked.has(entry.target)));
    onPickedChange(config.picked.size);
  };
  window.orbit.listFolders().then(rows=>{
    if(disposed)return;
    folders=(rows||[]).map(row=>({kind:'folder',name:row.name,target:row.path,args:'',icon:row.icon,group:row.group}));
    if(!folders.length){grid.innerHTML='<div class="app-search-status" role="status">Папок не знайдено. Скористайтеся кнопкою «Обрати папку…».</div>';return;}
    let previous='';
    grid.innerHTML=folders.map((entry,i)=>{
      const heading=entry.group!==previous?`<div class="folder-group" role="presentation">${GROUPS[entry.group]||''}</div>`:'';previous=entry.group;
      const picked=config.picked.has(entry.target);
      return `${heading}<button type="button" class="app-result folder-result ${picked?'picked':''}" role="option" data-folder="${i}" aria-checked="${picked}" title="${e(entry.target)}"><span class="app-result-icon">${icon(entry.icon||'folder',28)}</span><span class="app-result-copy"><strong>${e(entry.name)}</strong></span><span class="app-result-check" title="Позначити">${icon('check',12)}</span></button>`;
    }).join('');
  }).catch(()=>{if(!disposed)grid.innerHTML='<div class="app-search-status" role="status">Не вдалося отримати список папок. Скористайтеся кнопкою «Обрати папку…».</div>';});
  grid.addEventListener('click',event=>{
    const button=event.target.closest('[data-folder]');if(!button)return;
    const index=Number(button.dataset.folder);
    if(config.picked.size||event.ctrlKey||event.target.closest('.app-result-check'))toggle(index);else onChoose(folders[index]);
  });
  return ()=>{disposed=true;};
}
