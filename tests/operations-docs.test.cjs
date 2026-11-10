// Run with: node --test tests/operations-docs.test.cjs
// Keep current operating guidance usable after retiring one-off migration records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const root = path.join(__dirname, '..');
const maintained = ['README.md', 'backend/README.md', 'AGENTS.md', 'CLAUDE.md',
  'docs/parallel-playback-validation.md',
  'docs/plans/completed/20261108-parallel-playback-and-container-migration.md'];

test('completed migration documents and the retired incident backlog are absent', () => {
  for (const file of ['docs/container-migration-inventory.md',
    'docs/container-migration-runbook.md',
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

test('README owns storage operations and playback testing is optional', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /^### Operations$/m);
  for (const file of ['torrserver/config', 'torrserver/cache', 'jackett/config']) {
    assert.ok(readme.includes('/home/deploy/svtlvtv/' + file), file);
  }
  assert.ok(readme.includes('TS_DONTKILL=1'));
  assert.ok(readme.includes('full settings object'));
  const validation = fs.readFileSync(path.join(root, 'docs/parallel-playback-validation.md'), 'utf8');
  assert.match(validation, /optional reference/i);
  assert.match(validation, /not (?:a |an )?(?:scheduled|outstanding)/i);
});
