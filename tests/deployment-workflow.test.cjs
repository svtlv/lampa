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
const containers = ['svtlvtv_lampa_api', 'torrserver', 'jackett'];

function run(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-deploy-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const log = path.join(dir, 'commands.log');
  const fake = `
    fixture_round=0
    docker-compose() {
      printf 'compose %s\n' "$*" >> "$FIXTURE_LOG"
      if [ "$1" = "$FAIL_COMMAND" ]; then return 1; fi
    }
    docker() {
      printf 'docker %s\n' "$*" >> "$FIXTURE_LOG"
      case "$1 $2" in
        'network inspect') return "$NETWORK_RESULT" ;;
        'inspect --format')
          local container key states status last
          container="\${@: -1}"
          key="STATES_$container"
          read -r -a states <<< "\${!key}"
          last=$((\${#states[@]} - 1))
          status="\${states[$fixture_round]:-\${states[$last]}}"
          if [ "$status" = missing ]; then return 1; fi
          if [[ "$3" = *OOMKilled* ]]; then
            printf 'state=%s health=%s exit=0 oom=false restarts=0\n' "$status" "$status"
          else
            printf '%s\n' "$status"
          fi
          ;;
      esac
    }
    sleep() {
      printf 'sleep %s\n' "$*" >> "$FIXTURE_LOG"
      fixture_round=$((fixture_round + 1))
    }
  `;
  const result = spawnSync('bash', ['-c', fake + '\n' + remote], {
    // Use only synthetic inputs, with no inherited shell hooks or production credentials.
    env: {PATH: process.env.PATH, DEPLOY_DIR: dir, FIXTURE_LOG: log,
      FAIL_COMMAND: options.failCommand || '', NETWORK_RESULT: String(options.networkResult || 0),
      ...Object.fromEntries(containers.map(container =>
        ['STATES_' + container, (options.states?.[container] || ['healthy']).join(' ')]))},
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

test('normal deployment pulls, stops and starts the full stack, then waits for all three services', t => {
  const result = run(t, {networkResult: 1, states: {
    svtlvtv_lampa_api: ['starting', 'healthy'],
    torrserver: ['healthy'], jackett: ['starting', 'starting', 'healthy']
  }});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.filter(call => !call.startsWith('docker inspect') && !call.startsWith('sleep')), [
    'compose version', 'compose config --quiet', 'compose pull', 'compose down',
    'docker network inspect svtlv_monitoring_external',
    'docker network create svtlv_monitoring_external', 'compose up -d --no-build', 'docker image prune -f'
  ]);
  assert.equal(result.calls.filter(call => call === 'sleep 5').length, 2);
  for (const container of containers) {
    assert.equal(result.calls.filter(call => call.startsWith('docker inspect') && call.endsWith(' ' + container)).length, 3);
  }
  assert.match(result.stdout, /svtlvtv_lampa_api, torrserver and jackett are healthy/);
});

test('already healthy services finish without sleeping or changing the existing monitoring network', t => {
  const result = run(t);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.calls.some(call => call.startsWith('sleep') || call.startsWith('docker network create')));
});

for (const [container, status] of [
  ['svtlvtv_lampa_api', 'unhealthy'], ['torrserver', 'starting'], ['jackett', 'unhealthy'],
  ['torrserver', 'exited'], ['jackett', 'restarting'], ['torrserver', 'missing'], ['jackett', 'none']
]) {
  test('startup fails within the shared deadline for ' + container + ' ' + status, t => {
    const result = run(t, {states: {[container]: [status]}});
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.calls.filter(call => call === 'sleep 5').length, 36);
    assert.match(result.stderr, /must all be healthy within 3 minutes/);
    for (const name of containers) assert.ok(result.stderr.includes('Startup state: ' + name));
    assert.ok(result.stderr.includes(status), result.stderr);
    assert.ok(!result.calls.includes('docker image prune -f'));
    assert.deepEqual(result.calls.filter(call => call.startsWith('compose logs')), ['compose logs --tail=50 lampa-api']);
    // State diagnostics do not dump environments, probe output, vendor logs or private settings.
    const diagnostics = result.calls.filter(call => call.includes('OOMKilled'));
    assert.equal(diagnostics.length, 3);
    for (const call of diagnostics) assert.ok(!/\.Config|\.Log|\.Error/.test(call), call);
  });
}

test('a service must still be healthy when the last service becomes ready', t => {
  const result = run(t, {states: {torrserver: ['healthy', 'unhealthy'], jackett: ['starting', 'healthy']}});
  assert.equal(result.status, 1);
  assert.equal(result.calls.filter(call => call === 'sleep 5').length, 36);
});

test('Compose startup failure reports state without pruning or claiming success', t => {
  const result = run(t, {failCommand: 'up', states: {jackett: ['missing']}});
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /jackett is missing or cannot be inspected/);
  assert.ok(!result.calls.some(call => call.startsWith('sleep') || call === 'docker image prune -f'));
  assert.ok(!result.stdout.includes('are healthy'));
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
