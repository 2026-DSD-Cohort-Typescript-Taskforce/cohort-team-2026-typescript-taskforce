import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const serverRoot = join(__dirname, '..');
const extensionArchive =
  'node_modules/@browserbasehq/stagehand/dist/assets/stagehand-extension.zip';

test('Vercel bundles the Stagehand extension used before Browserbase session creation', async () => {
  const config = JSON.parse(await readFile(join(serverRoot, 'vercel.json'), 'utf8')) as {
    functions?: Record<string, { includeFiles?: string }>;
  };

  assert.equal(config.functions?.['src/server.ts']?.includeFiles, extensionArchive);
  await access(join(serverRoot, extensionArchive));
});
