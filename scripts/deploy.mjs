// Publishes app/ to the gh-pages branch (GitHub Pages).
//   node scripts/deploy.mjs staging     -> https://<user>.github.io/<repo>/staging/
//   node scripts/deploy.mjs production  -> https://<user>.github.io/<repo>/
// The two live side by side on gh-pages: production deploys never touch staging/ and vice versa.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!['staging', 'production'].includes(target)) {
  console.error('Usage: node scripts/deploy.mjs staging|production');
  process.exit(1);
}
const repo = fileURLToPath(new URL('..', import.meta.url));
const sh = (cmd, cwd = repo) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const branch = sh('git rev-parse --abbrev-ref HEAD');
const expected = target === 'staging' ? 'staging' : 'main';
if (branch !== expected) console.warn(`! Deploying ${target} from branch "${branch}" (usually "${expected}").`);
if (sh('git status --porcelain')) console.warn('! Working tree has uncommitted changes; they will be deployed too.');
const sha = sh('git rev-parse --short HEAD');

const dir = mkdtempSync(join(tmpdir(), 'wristcam-pages-'));
let hasRemote = true;
try { sh('git fetch origin gh-pages'); } catch { hasRemote = false; }
if (hasRemote) {
  sh(`git worktree add --force -B gh-pages "${dir}" origin/gh-pages`);
} else {
  sh(`git worktree add --force --detach "${dir}"`);
  sh('git checkout --orphan gh-pages', dir);
  sh('git rm -rf --quiet .', dir);
}

try {
  const dest = target === 'staging' ? join(dir, 'staging') : dir;
  // Clear the old build for this target only.
  if (target === 'staging') rmSync(dest, { recursive: true, force: true });
  else for (const f of readdirSync(dir)) if (!['.git', 'staging'].includes(f)) rmSync(join(dir, f), { recursive: true, force: true });

  cpSync(join(repo, 'app'), dest, { recursive: true });

  // Cache-bust relative module/style URLs so phones pick up new builds (Pages caches ~10 min).
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const file of walk(dest).filter((f) => /\.(js|html)$/.test(f))) {
    const src = readFileSync(file, 'utf8');
    const out = src.replace(/((?:\.\/|js\/)[\w\-/]+\.(?:js|css)|styles\.css)(['"])/g, `$1?v=${sha}$2`);
    if (out !== src) writeFileSync(file, out);
  }
  writeFileSync(join(dest, 'version.json'), JSON.stringify({ env: target, sha, builtAt: new Date().toISOString() }, null, 2));
  writeFileSync(join(dir, '.nojekyll'), '');
  if (!existsSync(join(dir, 'index.html'))) {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WristCam</title><body style="font-family:system-ui;background:#0b0f0d;color:#eee;padding:24px">Production is not deployed yet. <a style="color:#3ddc84" href="staging/">Open the staging build</a>.</body>');
  }

  sh('git add -A', dir);
  if (sh('git status --porcelain', dir)) {
    sh(`git commit -q -m "Deploy ${target} ${sha}"`, dir);
    sh('git push -q origin gh-pages', dir);
    console.log(`Deployed ${target} @ ${sha}. GitHub Pages updates in about a minute.`);
  } else {
    console.log('Nothing changed.');
  }
} finally {
  sh(`git worktree remove --force "${dir}"`);
}
