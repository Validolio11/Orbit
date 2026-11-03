const fsp = require('node:fs/promises');
const path = require('node:path');

// A program started by a packaged Windows app (Claude Desktop, for one) can inherit its file-system
// virtualization: writes under AppData then land in that app's private
// %LOCALAPPDATA%\Packages\<app>\LocalCache\Roaming copy, which an Orbit started at sign-in never sees.
// Writing a probe file and looking for it in those copies shows whether this process is affected.
// Returns the redirected folder, or null when writes reach the real one.
async function findRedirectedCopy(folder, { appData, localAppData }) {
  const relative = path.relative(appData, folder);
  if (!localAppData || !relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const probe = `.redirect-probe-${process.pid}-${Date.now()}`;
  await fsp.mkdir(folder, { recursive: true });
  await fsp.writeFile(path.join(folder, probe), '');
  try {
    const packages = path.join(localAppData, 'Packages');
    const names = await fsp.readdir(packages).catch(() => []);
    const copies = names.map(name => path.join(packages, name, 'LocalCache', 'Roaming', relative));
    const found = await Promise.all(copies.map(copy => fsp.access(path.join(copy, probe)).then(() => true, () => false)));
    return copies[found.indexOf(true)] ?? null;
  } finally { await fsp.unlink(path.join(folder, probe)).catch(() => {}); }
}

module.exports = { findRedirectedCopy };
