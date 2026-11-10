// Execute the workflow's actual remote script with shell fakes; never deploy or contact Docker.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-docker.yaml'), 'utf8');
const scripts = [...workflow.matchAll(/^        run: \|\n((?:          .*\n|\n)+)/gm)]
  .map(match => match[1].replace(/^          /gm, ''));
const deploy = scripts.find(script => script.includes("<<'REMOTE'"));
assert.ok(deploy, 'remote deploy script exists');
const remote = deploy.split("<<'REMOTE'\n")[1].split('\nREMOTE')[0];

function run(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-deploy-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const log = path.join(dir, 'commands.log');
  const fake = `
    docker-compose() {
      printf 'compose %s\n' "$*" >> "$FIXTURE_LOG"
      if [ "$1" = "$FAIL_COMMAND" ]; then return 1; fi
    }
    docker() {
      printf 'docker %s\n' "$*" >> "$FIXTURE_LOG"
      case "$1 $2" in
        'network inspect') return "$NETWORK_RESULT" ;;
      esac
    }
    sleep() {
      printf 'sleep %s\n' "$*" >> "$FIXTURE_LOG"
    }
  `;
  const result = spawnSync('bash', ['-c', fake + '\n' + remote], {
    // Use only synthetic inputs, with no inherited shell hooks or production credentials.
    env: {PATH: process.env.PATH, DEPLOY_DIR: dir, FIXTURE_LOG: log,
      FAIL_COMMAND: options.failCommand || '', NETWORK_RESULT: String(options.networkResult || 0)},
    encoding: 'utf8', timeout: 5000
  });
  assert.ifError(result.error);
  return {...result, calls: fs.readFileSync(log, 'utf8').trim().split('\n')};
}

test('every deployment shell block, including the remote body, passes bash syntax checks', () => {
  assert.equal(scripts.length, 12);
  for (const script of [...scripts, remote]) {
    const result = spawnSync('bash', ['-n'], {input: script, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
  }
});

test('normal deployment pulls, stops and starts the full stack without polling health', t => {
  const result = run(t, {networkResult: 1});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    'compose version', 'compose config --quiet', 'compose pull', 'compose down',
    'docker network inspect svtlv_monitoring_external',
    'docker network create svtlv_monitoring_external', 'compose up -d --no-build', 'docker image prune -f'
  ]);
});

test('deployment reuses the existing monitoring network without waiting for health', t => {
  const result = run(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    'compose version', 'compose config --quiet', 'compose pull', 'compose down',
    'docker network inspect svtlv_monitoring_external', 'compose up -d --no-build', 'docker image prune -f'
  ]);
});

test('Compose startup failure stops deployment before image cleanup', t => {
  const result = run(t, {failCommand: 'up'});
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.calls, [
    'compose version', 'compose config --quiet', 'compose pull', 'compose down',
    'docker network inspect svtlv_monitoring_external', 'compose up -d --no-build'
  ]);
});

test('pull failure leaves the running stack alone', t => {
  const result = run(t, {failCommand: 'pull'});
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, ['compose version', 'compose config --quiet', 'compose pull']);
});

test('deployment keeps its manual trigger, branch/environment gates and web/API-only build matrix', () => {
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /if \[ "\$REF_NAME" != "\$DEFAULT_BRANCH" \]/);
  assert.match(workflow, /if \[ "\$ENVIRONMENT" = "Development" \]/);
  const matrix = workflow.split('      matrix:\n')[1].split('\n    steps:')[0];
  assert.deepEqual([...matrix.matchAll(/- name: (\w+)/g)].map(match => match[1]), ['web', 'api']);
});
