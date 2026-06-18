// After `react-router build`, the prerendered HTML lands under
// `build/client/supergrain/` (because of the `/supergrain/` basename) while
// hashed assets land in `build/client/assets/` and reference `/supergrain/assets/...`.
//
// GitHub Pages serves a project site's artifact at `/supergrain/`, so the
// artifact root must itself contain the full site. This flattens everything
// under `build/client/` into `build/client/supergrain/` so that uploading that
// single directory serves correctly at https://commoncurriculum.github.io/supergrain/.
import { readdirSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const clientDir = 'build/client';
const target = join(clientDir, 'supergrain');

if (!existsSync(target)) {
  throw new Error(
    `Expected ${target} to exist. Did "react-router build" run with basename "/supergrain/"?`,
  );
}

mkdirSync(target, { recursive: true });

for (const entry of readdirSync(clientDir)) {
  if (entry === 'supergrain') continue;
  renameSync(join(clientDir, entry), join(target, entry));
}

console.log(`Flattened ${clientDir}/* into ${target}/ for GitHub Pages (/supergrain/).`);
