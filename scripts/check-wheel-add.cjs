const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');

// The wheel's "+" slot: adding the program in front, the add-dialog fallback, and the first-run hint.
(async()=>{
  const project=path.resolve(__dirname,'..');
  const app=await _electron.launch({args:[project,'--e2e'],executablePath:require('electron'),cwd:project});
  try{
    await app.firstWindow();let page;
    for(let n=0;n<100;n++){page=app.windows().find(w=>w.url().endsWith('/index.html'));if(page)break;await new Promise(r=>setTimeout(r,50));}
    if(!page)throw new Error('Main window missing');page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForSelector('html[data-ready="true"]');
    const state=()=>page.evaluate(()=>window.orbit.getState());

    await page.locator('.intro-card').waitFor();
    await page.locator('[data-command="dismiss-intro"]').click();
    await page.locator('.intro-card').waitFor({state:'detached'});
    assert.equal((await state()).introPending,false);
    console.log('PASS: first-run hint shows on a fresh profile and is dismissed');

    const before=(await state()).menus[0].items.length;
    await page.locator('[data-command="preview"]').click();
    const overlay=app.windows().find(w=>w.url().includes('overlay=1'));overlay.setDefaultTimeout(10000);
    errors.length=0;overlay.on('pageerror',error=>errors.push(error.message));
    await overlay.locator('.wheel-item.wheel-add').waitFor();
    assert.equal(await overlay.locator('.wheel-item.wheel-add .wheel-add-app').count(),0,'Without a known program the slot is a plain "+"');
    const notepad=path.join(process.env.WINDIR||'C:\\Windows','System32','notepad.exe');
    await app.evaluate((_,target)=>globalThis.__orbitE2E.resolveForeground(target),notepad);
    await overlay.locator('.wheel-item.wheel-add .wheel-add-app').waitFor();
    const label=await overlay.locator('.wheel-item.wheel-add .wheel-item-label').textContent();
    // Hovering the slot never adds anything.
    const box=await overlay.locator('.wheel-item.wheel-add').boundingBox();
    await overlay.mouse.move(box.x+box.width/2,box.y+box.height/2);await overlay.waitForTimeout(900);
    assert.equal((await state()).menus[0].items.length,before,'Hover must not add');
    await overlay.locator('.wheel-item.wheel-add').click();
    await overlay.waitForFunction(count=>document.querySelectorAll('.wheel-item:not(.wheel-add)').length===count,before+1);
    const added=(await state()).menus[0].items.at(-1);
    assert.equal(added.target.toLowerCase().endsWith('notepad.exe')||added.target.toLowerCase().endsWith('.lnk'),true);
    assert.equal(added.name,label);
    assert.equal(await overlay.locator(`[data-wheel-id="${added.id}"].selected`).count(),1,'The new action is selected in the open wheel');
    assert.equal(await overlay.locator('.wheel-item.wheel-add .wheel-add-app').count(),0,'An added program is not offered again');
    console.log(`PASS: "+" offers the program in front (${label}), ignores hover, adds on click and keeps the wheel open`);

    await overlay.locator('.wheel-item.wheel-add').click();
    await page.getByRole('dialog').getByRole('heading',{name:'Додати дію'}).waitFor();
    const visible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('overlay=1')).isVisible());
    assert.equal(visible,false);
    console.log('PASS: plain "+" closes the wheel and opens the add dialog');

    // Folder tab: a Windows tile name is not carried over, and a folder tile adds itself under its own name.
    const form=page.getByRole('dialog');
    await form.locator('[data-kind="system"]').click();await form.locator('[data-system="explorer"]').click();
    await form.locator('[data-kind="folder"]').click();
    await form.locator('.app-advanced>summary').click();
    assert.equal(await form.locator('#action-name').inputValue(),'','A tile name must not carry over to another type');
    const documents=form.locator('.folder-result').filter({hasText:'Документи'});await documents.waitFor();
    const documentsPath=await documents.getAttribute('title');
    await documents.click();await page.waitForSelector('#modal-root:empty',{state:'attached'});
    const folder=(await state()).menus[0].items.at(-1);
    assert.equal(folder.kind,'folder');assert.equal(folder.name,'Документи');assert.equal(folder.target,documentsPath);
    console.log('PASS: folder tile adds itself with its name; names do not carry over between types');

    // Script tab: scripts next to an existing script action appear as tiles and a click adds one named after its file.
    const scriptsDir=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-scripts-'));
    try{
      await fs.writeFile(path.join(scriptsDir,'Render scene.ps1'),'Write-Output 1');await fs.writeFile(path.join(scriptsDir,'cleanup.py'),'print(1)');await fs.writeFile(path.join(scriptsDir,'notes.txt'),'x');
      const seeded=await state();seeded.menus[0].items.push({id:'qa-script',name:'QA script',kind:'script',target:path.join(scriptsDir,'cleanup.py'),args:'',icon:'',children:[]});
      await page.evaluate(next=>window.orbit.saveState(next),seeded);
      await page.locator('.panel-head [data-command="add-action"]').click();await form.locator('[data-kind="script"]').click();
      const render=form.locator('.script-result').filter({hasText:'Render scene'});await render.waitFor();
      assert.equal(await form.locator('.script-result').filter({hasText:'notes'}).count(),0,'Only runnable scripts are listed');
      assert.equal(await render.locator('.script-type').textContent(),'PS1');
      await form.locator('#script-search').fill('clean');
      assert.equal(await form.locator('.script-result').count(),1,'The filter narrows the tiles');
      await form.locator('#script-search').fill('');
      await render.click();await page.waitForSelector('#modal-root:empty',{state:'attached'});
      const script=(await state()).menus[0].items.at(-1);
      assert.equal(script.kind,'script');assert.equal(script.name,'Render scene');assert.equal(script.target,path.join(scriptsDir,'Render scene.ps1'));
      console.log('PASS: script tiles list runnable scripts with their type, filter, and add one named after its file');
    }finally{await fs.rm(scriptsDir,{recursive:true,force:true});}
    assert.deepEqual(errors,[]);
    console.log('ORBIT_WHEEL_ADD_OK');
  }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
