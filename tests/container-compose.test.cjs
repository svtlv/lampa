// Run with: node --test tests/container-compose.test.cjs
// Requires the Docker Compose CLI, but never contacts a daemon or starts services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');

const root = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(root, 'devops/docker-compose.yaml'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-docker.yaml'), 'utf8');
const example = fs.readFileSync(path.join(root, 'devops/.env.example'), 'utf8');
const pin = 'ghcr.io/yourok/torrserver:MatriX.150';
const jackettPin = 'lscr.io/linuxserver/jackett:v0.24.3030-ls30';
// Ignore real account/deploy inputs and implicit Compose overrides in the test environment.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(LAMPA_|COMPOSE_|DOCKER_DEFAULT_PLATFORM$)/.test(key)));

function fixture(t, content = compose, dotenv = example) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lampa-compose-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'devops'));
  fs.writeFileSync(path.join(dir, 'devops/docker-compose.yaml'), content);
  fs.writeFileSync(path.join(dir, 'fixture.env'), dotenv);
  return dir;
}

function render(dir) {
  return spawnSync('docker', ['compose', '--project-name', 'lampa-fixture',
    '--project-directory', path.join(root, 'devops'),
    '-f', path.join(dir, 'devops/docker-compose.yaml'),
    '--env-file', path.join(dir, 'fixture.env'), 'config', '--format', 'json'],
  {env, encoding: 'utf8', timeout: 15000});
}

function config(dir) {
  const result = render(dir);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function workflowScript(name) {
  const step = workflow.split('      - name: ' + name + '\n')[1];
  assert.ok(step, 'workflow step must exist: ' + name);
  const script = step.split('        run: |\n')[1]?.match(/^(?:          .*\n|\n)+/)?.[0];
  assert.ok(script, 'workflow step must have a shell script: ' + name);
  return script.replace(/^          /gm, '');
}

test('PostgreSQL publishes port 5434 on host interfaces for Hermes', t => {
  const database = config(fixture(t)).services['lampa-db'];
  assert.equal(database.ports.length, 1);
  assert.ok(!database.ports[0].host_ip || database.ports[0].host_ip === '0.0.0.0');
  assert.equal(database.ports[0].published, '5434');
  assert.equal(database.ports[0].target, 5432);
  assert.equal(database.ports[0].protocol, 'tcp');
});

test('TorrServer retains its image, runtime, data, public TCP port and both network aliases', t => {
  const model = config(fixture(t));
  const server = model.services.torrserver;
  assert.equal(server.image, pin);
  assert.equal(server.container_name, 'torrserver');
  assert.equal(server.user, '0:0');
  assert.equal(server.restart, 'unless-stopped');
  assert.deepEqual(server.environment, {
    TS_CONF_PATH: '/opt/ts/config', TS_LOG_PATH: '/opt/ts/log',
    TS_TORR_DIR: '/opt/ts/torrents', TS_PORT: '8090', TS_DONTKILL: '1',
    GODEBUG: 'madvdontneed=1'
  });
  // Use the vendor entrypoint unchanged; no auth flags, migration or settings rewrite.
  for (const key of ['command', 'entrypoint', 'depends_on', 'mem_limit', 'memswap_limit', 'cpus', 'pids_limit', 'deploy']) {
    assert.ok(server[key] == null, key);
  }
  assert.equal(server.volumes.length, 2);
  assert.deepEqual(server.volumes.map(({type, source, target, read_only}) =>
    ({type, source, target, read_only: !!read_only})), [
    {type: 'bind', source: '/home/deploy/svtlvtv/torrserver/config', target: '/opt/ts/config', read_only: false},
    {type: 'bind', source: '/home/deploy/svtlvtv/torrserver/cache', target: '/opt/ts/torrents', read_only: false}
  ]);
  assert.equal(server.ports.length, 1);
  assert.equal(server.ports[0].published, '8090');
  assert.equal(server.ports[0].target, 8090);
  assert.equal(server.ports[0].protocol, 'tcp');
  assert.ok(!server.ports[0].host_ip || server.ports[0].host_ip === '0.0.0.0');
  assert.deepEqual(server.networks, {
    default: {aliases: ['torrserver']}, monitoring_external: {aliases: ['torrserver']}
  });
  assert.equal(model.networks.monitoring_external.name, 'svtlv_monitoring_external');
  assert.equal(model.networks.monitoring_external.external, true);
  assert.equal(model.services['lampa-web'].ports[0].published, '8092');
  assert.deepEqual(Object.keys(model.volumes), ['lampa_db_data']);
});

test('TorrServer liveness uses only the bounded credential-free version endpoint', t => {
  const health = config(fixture(t)).services.torrserver.healthcheck;
  assert.deepEqual(health.test,
    ['CMD', 'wget', '-q', '-T', '3', '-O', '/dev/null', 'http://127.0.0.1:8090/echo']);
  assert.equal(health.interval, '30s');
  assert.equal(health.timeout, '5s');
  assert.equal(health.start_period, '30s');
  assert.equal(health.retries, 5);
});

test('Jackett preserves its pinned image, s6 identity, no-update environment and complete config bind', t => {
  const model = config(fixture(t));
  const server = model.services.jackett;
  assert.equal(server.image, jackettPin);
  assert.equal(server.container_name, 'jackett');
  assert.equal(server.restart, 'unless-stopped');
  assert.deepEqual(server.environment, {
    PUID: '1000', PGID: '1000', TZ: 'Asia/Jerusalem',
    XDG_DATA_HOME: '/config', XDG_CONFIG_HOME: '/config', TMPDIR: '/run/jackett-temp'
  });
  // Leave /init and the vendor launcher intact, including --NoUpdates by default.
  for (const key of ['user', 'command', 'entrypoint', 'depends_on', 'mem_limit', 'memswap_limit', 'cpus', 'pids_limit', 'deploy']) {
    assert.ok(server[key] == null, key);
  }
  assert.deepEqual(server.volumes.map(({type, source, target, read_only}) =>
    ({type, source, target, read_only: !!read_only})), [
    {type: 'bind', source: '/home/deploy/svtlvtv/jackett/config', target: '/config', read_only: false}
  ]);
  assert.deepEqual(Object.keys(model.services).sort(),
    ['jackett', 'lampa-api', 'lampa-db', 'lampa-web', 'torrserver']);
});

test('Jackett keeps its public TCP endpoint and Torznab DNS alias on both networks', t => {
  const model = config(fixture(t));
  const server = model.services.jackett;
  assert.equal(server.ports.length, 1);
  assert.equal(server.ports[0].published, '9117');
  assert.equal(server.ports[0].target, 9117);
  assert.equal(server.ports[0].protocol, 'tcp');
  assert.ok(!server.ports[0].host_ip || server.ports[0].host_ip === '0.0.0.0');
  assert.deepEqual(server.networks, {
    default: {aliases: ['jackett']}, monitoring_external: {aliases: ['jackett']}
  });
  for (const network of Object.keys(server.networks)) {
    assert.ok(model.services.torrserver.networks[network]);
  }
});

test('Jackett readiness uses a bounded anonymous health request without searching indexers', t => {
  const health = config(fixture(t)).services.jackett.healthcheck;
  assert.deepEqual(health.test, ['CMD', 'curl', '-fsS', '--max-time', '3',
    '--output', '/dev/null', 'http://127.0.0.1:9117/health']);
  assert.equal(health.interval, '30s');
  assert.equal(health.timeout, '5s');
  assert.equal(health.start_period, '30s');
  assert.equal(health.retries, 5);
});

test('Compose rejects an invalid Jackett port mapping', t => {
  const result = render(fixture(t, compose.replace('9117:9117/tcp', 'invalid:9117/tcp')));
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /port/i);
});

for (const environment of ['Test', 'Production', '']) {
  test('Compose preserves the API environment and vendor service: ' + (environment || 'default'), t => {
    const dotenv = example.replace(/^LAMPA_ENVIRONMENT=.*$/m, environment ? 'LAMPA_ENVIRONMENT=' + environment : '');
    const model = config(fixture(t, compose, dotenv));
    assert.equal(model.services['lampa-api'].environment.LAMPA_ENVIRONMENT, environment || 'Test');
    assert.equal(model.services.torrserver.image, pin);
    assert.equal(model.services.jackett.image, jackettPin);
  });
}

for (const key of ['LAMPA_DB_PASSWORD', 'LAMPA_API_DATA_KEY', 'LAMPA_KEYCLOAK_CLIENT_SECRET']) {
  for (const empty of [false, true]) {
    test('Compose rejects ' + (empty ? 'empty ' : 'missing ') + key, t => {
      const dotenv = example.replace(new RegExp('^' + key + '=.*$', 'm'), empty ? key + '=' : '');
      const result = render(fixture(t, compose, dotenv));
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(key), result.stderr);
    });
  }
}

test('Compose rejects an invalid TorrServer port mapping', t => {
  const result = render(fixture(t, compose.replace('8090:8090/tcp', 'invalid:8090/tcp')));
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /port/i);
});

test('the actual release transformation keeps vendor services intact and rewrites only local images', t => {
  const dir = fixture(t);
  const before = config(dir);
  const script = workflowScript('Prepare docker-compose for release');
  const syntax = spawnSync('bash', ['-n'], {input: script, encoding: 'utf8'});
  assert.equal(syntax.status, 0, syntax.stderr);
  // The release runner uses GNU sed; BSD sed needs an explicit empty backup suffix.
  const localScript = process.platform === 'darwin' ? script.replace(/sed -i /g, "sed -i '' ") : script;
  const transformed = spawnSync('bash', ['-eu', '-c', localScript], {
    cwd: dir, env: {...env, REGISTRY: 'ghcr.io', IMAGE_PREFIX: 'fixture/lampa'},
    encoding: 'utf8', timeout: 15000
  });
  assert.equal(transformed.status, 0, transformed.stderr);
  const after = config(dir);
  assert.deepEqual(after.services.torrserver, before.services.torrserver);
  assert.deepEqual(after.services.jackett, before.services.jackett);
  assert.deepEqual(after.networks, before.networks);
  assert.deepEqual(after.volumes, before.volumes);
  for (const service of ['web', 'api']) {
    assert.equal(after.services['lampa-' + service].build, undefined);
    assert.equal(after.services['lampa-' + service].image, 'ghcr.io/fixture/lampa-' + service + ':latest');
  }
  assert.equal(after.services['lampa-db'].image, before.services['lampa-db'].image);
});

test('deployment validation accepts safe fixtures and rejects malformed secret inputs', () => {
  const script = workflowScript('Validate required configuration');
  const valid = {DEPLOY_DIR: '/home/deploy/svtlvtv', GHCR_PAT: 'fixture',
    LAMPA_DB_PASSWORD: 'a'.repeat(64), LAMPA_API_DATA_KEY: Buffer.alloc(32).toString('base64'),
    LAMPA_KEYCLOAK_CLIENT_SECRET: 'fixture-client-secret', SSH_PRIVATE_KEY: 'fixture',
    SSH_USER: 'fixture', TAILSCALE_AUTHKEY: 'fixture'};
  for (const [key, value] of [[null, null], ['LAMPA_DB_PASSWORD', 'not-hex'],
    ['LAMPA_API_DATA_KEY', 'invalid'], ['LAMPA_KEYCLOAK_CLIENT_SECRET', 'invalid$secret']]) {
    const result = spawnSync('bash', ['-eu', '-c', script], {
      env: {...env, ...valid, ...(key ? {[key]: value} : {})}, encoding: 'utf8', timeout: 15000
    });
    assert.ifError(result.error);
    if (!key) assert.equal(result.status, 0, result.stderr);
    else {
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(key), result.stderr);
    }
  }
});
