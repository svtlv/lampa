// Run with: node --test tests/operations-docs.test.cjs
// Keep current operating guidance usable after retiring one-off records and guides.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const root = path.join(__dirname, '..');
const maintained = ['README.md', 'backend/README.md', 'AGENTS.md', 'CLAUDE.md',
  'docs/design/settings-sync-backend-design.md',
  'docs/plans/completed/20261108-parallel-playback-and-container-migration.md'];

test('completed migration documents, validation guide and retired backlog are absent', () => {
  for (const file of ['docs/container-migration-inventory.md',
    'docs/container-migration-runbook.md', 'docs/parallel-playback-validation.md',
    'docs/backlog/parallel-playback-resource-peaks-and-configuration.md']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
});

test('maintained operating guidance has no broken local document links', () => {
  for (const file of maintained) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, link] of content.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
      const target = decodeURIComponent(link.split('#')[0]);
      if (!target) continue;
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file}: ${link}`);
    }
  }
});

test('README owns storage operations and a short collector usage example', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /^### Operations$/m);
  for (const file of ['torrserver/config', 'torrserver/cache', 'jackett/config']) {
    assert.ok(readme.includes('/home/deploy/svtlvtv/' + file), file);
  }
  assert.ok(readme.includes('TS_DONTKILL=1'));
  assert.ok(readme.includes('full settings object'));
  assert.ok(readme.includes('bash devops/measure-playback.sh'));
  assert.ok(readme.includes('--duration') && readme.includes('--interval'));
});
