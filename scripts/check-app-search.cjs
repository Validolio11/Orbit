const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');

(async()=>{
  const project=path.resolve(__dirname,'..');
  const packaged=process.argv.includes('--packaged');
  const app=await _electron.launch({args:packaged?['--e2e']:[project,'--e2e'],executablePath:packaged?path.join(project,'dist','Orbit-win32-x64','Orbit.exe'):require('electron'),cwd:project});
  try{
    await app.firstWindow();let page;
    for(let n=0;n<100;n++){page=app.windows().find(p=>p.url().endsWith('/index.html'));if(page)break;await new Promise(r=>setTimeout(r,50));}
    if(!page)throw new Error('Main window missing');page.setDefaultTimeout(15000);
    await page.waitForSelector('html[data-ready="true"]');
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('overlay=1'));w.webContents.setBackgroundThrottling(false);w.hide();});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const installed=await page.evaluate(()=>window.orbit.searchApps('Illustrator'));
    const candidate=installed.apps[0]||(await page.evaluate(()=>window.orbit.searchApps(''))).apps[0];
    assert.ok(candidate,'At least one installed Windows app must be indexed');
    const add=()=>page.locator('.panel-head [data-command="add-action"]').click();
    const dialog=()=>page.getByRole('dialog');
    const closeDialog=()=>dialog().getByRole('button',{name:'Скасувати',exact:true}).click();
    const waitClosed=()=>page.waitForSelector('#modal-root:empty',{state:'attached'});
    await add();
    assert.equal(await page.getByLabel('Знайти застосунок',{exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.getByLabel('Знайти застосунок',{exact:true}).fill(candidate.name);
    await page.locator('.app-result-copy strong').filter({hasText:candidate.name}).first().waitFor();
    await page.getByLabel('Знайти застосунок',{exact:true}).press('ArrowDown');
    await page.getByLabel('Знайти застосунок',{exact:true}).press('Enter');
    assert.equal(await dialog().count(),1,'Choosing a result must not submit the action');
    assert.equal(await page.getByLabel('Назва в колесі').inputValue(),candidate.name);
    assert.equal(await page.locator('#action-target').inputValue(),candidate.target);
    await page.getByLabel('Назва в колесі').fill('QA обрана програма');
    await dialog().getByRole('button',{name:'Додати дію',exact:true}).click();await waitClosed();
    let saved=await page.evaluate(()=>window.orbit.getState());
    const action=saved.menus[0].items.find(i=>i.name==='QA обрана програма');
    assert.equal(action.target,candidate.target);
    await page.reload();await page.waitForSelector('html[data-ready="true"]');
    await page.locator('.action-row').filter({hasText:'QA обрана програма'}).waitFor();
    console.log('PASS: actual installed-app search, autofocus, keyboard select, auto fields, alias and persistence');

    await add();await page.getByLabel('Знайти застосунок',{exact:true}).fill('no-such-orbit-app-zzzz-12345');
    await page.getByText('Нічого не знайдено. Спробуйте іншу назву або оберіть файл.',{exact:true}).waitFor();
    await page.keyboard.press('Escape');assert.equal(await dialog().count(),1);
    await dialog().locator('[data-app-mode="url"]').click();
    await page.getByLabel('Посилання',{exact:true}).fill('https://example.com');
    await page.getByLabel('Назва в колесі').fill('QA посилання');
    await dialog().getByRole('button',{name:'Додати дію',exact:true}).click();await waitClosed();
    saved=await page.evaluate(()=>window.orbit.getState());assert.equal(saved.menus[0].items.find(i=>i.name==='QA посилання').target,'https://example.com');
    console.log('PASS: empty search, Escape preserves dialog, URL fallback');

    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:['C:\\QA\\Portable.exe']});});
    await add();await dialog().getByRole('button',{name:'Обрати файл…',exact:true}).click();
    await page.locator('#selected-app').filter({hasText:'Portable'}).waitFor();
    assert.equal(await page.locator('#action-target').inputValue(),'C:\\QA\\Portable.exe');
    await closeDialog();await waitClosed();
    const count=await page.locator('.action-list .action-row').count();
    await page.getByRole('button',{name:'Видалити дію QA обрана програма',exact:true}).click();await closeDialog();
    assert.equal(await page.locator('.action-list .action-row').count(),count);
    await page.getByRole('button',{name:'Видалити дію QA обрана програма',exact:true}).click();await dialog().locator('#confirm-delete').click();await waitClosed();
    assert.equal(await page.locator('.action-list .action-row').count(),count-1);
    assert.equal(await page.locator('#preview-wheel [data-wheel-id="'+action.id+'"]').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: file picker fallback, per-action trash/cancel/delete, wheel update; no renderer errors');
    console.log('ORBIT_APP_SEARCH_OK');
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
