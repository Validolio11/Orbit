const fsp = require('node:fs/promises');

// Saves so that a power cut during or right after a save cannot lose the menus: the new text is
// flushed to disk before it replaces the file, and the previous good file is kept as <file>.bak.
async function writeDurable(file, text) {
  const temp = file + '.tmp';
  const handle = await fsp.open(temp, 'w', 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  await fsp.copyFile(file, file + '.bak').catch(error => { if (error.code !== 'ENOENT') throw error; });
  await fsp.rename(temp, file);
}

// Reads the settings, falling back to the backup when the main file is missing or does not parse.
// Throws the main file's error when neither copy is usable (ENOENT for both means a first run).
async function readWithBackup(file, parse) {
  let mainError;
  try { return { value: parse(await fsp.readFile(file, 'utf8')), source: 'main' }; }
  catch (error) { mainError = error; }
  try { return { value: parse(await fsp.readFile(file + '.bak', 'utf8')), source: 'backup', error: mainError }; }
  catch { throw mainError; }
}

module.exports = { writeDurable, readWithBackup };
