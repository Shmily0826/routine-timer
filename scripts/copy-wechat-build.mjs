import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Read+write each file instead of fs.cp: the WorkBuddy-managed Node 22 wires
// fs.cp's overwrite path through a safe-delete (trash) shim, and that trash
// gets aborted ("Some operations were aborted"), losing the destination file.
// read+write truncates-and-writes in place, never unlinks, so the shim is
// never invoked for the project files. The final rm of .wechat-build is
// internal (gitignored) and harmless if the shim aborts it.
const SRC = '.wechat-build';
const DST = 'miniprogram';

async function copyAll(src, dst) {
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) {
      await mkdir(d, { recursive: true });
      await copyAll(s, d);
    } else {
      await mkdir(dirname(d), { recursive: true });
      await writeFile(d, await readFile(s));
    }
  }
}

await mkdir(DST, { recursive: true });
await copyAll(SRC, DST);
// Best-effort cleanup of the intermediate build dir (gitignored). The Node
// safe-delete shim can abort the trash, but leaving .wechat-build around is
// harmless: tsc recreates it on the next run, and it is never committed.
try {
  await rm(SRC, { recursive: true, force: true });
} catch (e) {
  console.warn('warn: .wechat-build cleanup failed (leaving in place, gitignored): ' + e.message);
}
