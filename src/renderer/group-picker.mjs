import {icon,itemIcon,hydrateAppIcons} from './icons.mjs';
import {escapeHTML as e} from './wheel.mjs';

// Ordered by theme: favourites and people, communication, creative work, media, internet and AI, computer, study and money, everything else.
export const GROUP_ICONS=[
  ['group','Група'],['star','Обране'],['heart','Улюблене'],['bookmark','Закладки'],['briefcase','Робота'],['users','Команда'],['user','Особисте'],['home','Дім'],['calendar','Календар'],
  ['clock','Час'],['mail','Пошта'],['chat','Чати'],['phone','Телефон'],['palette','Дизайн'],['layers','Шари'],['cube','3D'],['image','Фото'],['camera','Камера'],
  ['film','Медіа'],['video','Відео'],['tv','ТБ'],['music','Музика'],['headphones','Навушники'],['mic','Мікрофон'],['gamepad','Ігри'],['trophy','Досягнення'],['emoji','Розваги'],
  ['browser','Інтернет'],['cloud','Хмара'],['wifi','Мережа'],['map','Мапи'],['sparkles','ШІ'],['bot','Бот'],['cpu','Процесор'],['script','Код'],['database','Бази даних'],
  ['server','Сервер'],['system','Комп’ютер'],['drive','Диск'],['keyboard','Клавіатура'],['settings','Утиліти'],['zap','Швидкі дії'],['rocket','Запуск'],['shield','Захист'],['key','Ключі'],
  ['lock','Приватне'],['book','Книги'],['graduation','Навчання'],['notepad','Документи'],['clipboard','Нотатки'],['chart','Аналітика'],['wallet','Фінанси'],['cart','Покупки'],['calculator','Розрахунки'],
  ['box','Архів'],['printer','Друк'],['folder','Папки'],['app','Програми'],['flask','Наука'],['leaf','Природа'],['coffee','Перерва'],['gift','Подарунки'],['tag','Мітки'],
];
// A suggested name also picks a fitting icon unless the user already chose one.
const SUGGESTIONS=[['Робота','briefcase'],['Дизайн','palette'],['Ігри','gamepad'],['Браузери','browser'],['Медіа','film'],['Утиліти','settings']];

export function groupPickerFields(draft,config,items){
  const current=draft.icon||'group';
  const nameField=`<div class="field"><label for="action-name">Назва групи</label><input id="action-name" name="name" maxlength="100" value="${e(draft.name)}" placeholder="Нова група" autocomplete="off"><div class="name-chips" role="group" aria-label="Готові назви">${SUGGESTIONS.map(([name,glyph])=>`<button type="button" class="name-chip" data-group-name="${e(name)}" data-group-glyph="${glyph}">${name}</button>`).join('')}</div></div>`;
  const iconField=`<div class="field"><span class="field-title" id="group-icon-title">Значок</span><div class="icon-choices" role="radiogroup" aria-labelledby="group-icon-title">${GROUP_ICONS.map(([name,label])=>`<button type="button" class="icon-choice ${current===name?'active':''}" role="radio" aria-checked="${current===name}" data-group-icon="${name}" title="${label}" aria-label="${label}">${icon(name,18)}</button>`).join('')}</div></div>`;
  if(!config.moveIds)return `${nameField}${iconField}`;
  const moveField=items.length?`<div class="field"><span class="field-title" id="group-move-title">Перенести в групу <span class="optional-label">· необов’язково</span></span><div class="app-grid group-move-grid" role="listbox" aria-labelledby="group-move-title" aria-multiselectable="true">${items.map(item=>`<button type="button" class="app-result group-move ${config.moveIds.has(item.id)?'picked':''}" role="option" aria-selected="${config.moveIds.has(item.id)}" data-move-id="${e(item.id)}" title="${e(item.name)}"><span class="app-result-icon">${itemIcon(item,28)}</span><span class="app-result-copy"><strong>${e(item.name)}</strong></span><span class="app-result-check">${icon('check',12)}</span></button>`).join('')}</div><small class="app-grid-hint">Позначені дії одразу переїдуть у нову групу. Після створення група відкриється, щоб додати ще.</small></div>`
    :'<p class="field-note">Після створення група відкриється, щоб ви додали в неї дії.</p>';
  return `${nameField}${iconField}${moveField}`;
}

export function mountGroupPicker({form,draft,config,onMoveChange=()=>{}}){
  const name=form.querySelector('#action-name');
  let iconChosen=!!draft.icon&&draft.icon!=='group';
  const chooseIcon=glyph=>{
    draft.icon=glyph;
    form.querySelectorAll('[data-group-icon]').forEach(node=>{const active=node.dataset.groupIcon===glyph;node.classList.toggle('active',active);node.setAttribute('aria-checked',String(active));});
  };
  form.querySelectorAll('[data-group-icon]').forEach(button=>button.addEventListener('click',()=>{iconChosen=true;chooseIcon(button.dataset.groupIcon);}));
  form.querySelectorAll('[data-group-name]').forEach(button=>button.addEventListener('click',()=>{
    name.value=button.dataset.groupName;name.dispatchEvent(new Event('input',{bubbles:true}));
    if(!iconChosen)chooseIcon(button.dataset.groupGlyph);
    name.focus();
  }));
  form.querySelectorAll('[data-move-id]').forEach(button=>button.addEventListener('click',()=>{
    const id=button.dataset.moveId;
    if(config.moveIds.has(id))config.moveIds.delete(id);else config.moveIds.add(id);
    button.classList.toggle('picked',config.moveIds.has(id));button.setAttribute('aria-selected',String(config.moveIds.has(id)));
    onMoveChange(config.moveIds.size);
  }));
  hydrateAppIcons(form);
  return ()=>{};
}
