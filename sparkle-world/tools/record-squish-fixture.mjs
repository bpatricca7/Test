// Records tools/fixtures/squish-rich-profile.json (docs/teams/squishies.md §15 step 2): a fresh
// profile on the build as it is, one world, 1,940 earned coins, saved and copied out. Run it on
// the untouched tree only (the fixture stands for a profile saved before the squishy toys).
//
//   node tools/build.mjs && node tools/record-squish-fixture.mjs

import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { launch, openGame, startWorld, settle, ROOT } from './smoke.mjs';

const errors = [];
const browser = await launch();
try {
  const { page } = await openGame(browser, { errors, label: 'record' });
  await startWorld(page, 'meadow');
  const profile = await page.evaluate(async () => {
    const g = window.__game;
    g.coins.add(1940, 'gift', { fly: false });
    await new Promise((r) => setTimeout(r, 1500));
    await g.saveProfile(true);
    return JSON.parse(JSON.stringify(g.profile));
  });
  await settle(page, 300);
  if (errors.length) throw new Error(errors.join('\n'));
  if (profile.squish) throw new Error('this build already has squishy toys: record on the untouched tree');
  const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  const out = {
    about: `A real profile saved by the build before squishy toys (commit ${commit}), with about 2,000 earned coins, for probe-squish E3.`,
    profile,
  };
  await writeFile(path.join(ROOT, 'tools/fixtures/squish-rich-profile.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(`recorded: coins ${profile.coins}, coinsEarned ${profile.stats.coinsEarned}`);
} finally {
  await browser.close();
}
