// Synthetic /proc, cgroup and Docker responses only. Never contact a daemon or play media.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync, spawn} = require('node:child_process');
const {test} = require('node:test');
const root = path.join(__dirname, '..');
const script = path.join(root, 'devops/measure-playback.sh');
const companion = path.join(root, 'devops/measure-playback.py');
const psi = 'some avg10=1.25 avg60=0.50 avg300=0.10 total=12345\nfull avg10=0.25 avg60=0.10 avg300=0.00 total=100\n';
const network = (rx = 100, tx = 200) => 'Inter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n private-interface: ' + rx + ' 1 0 0 0 0 0 0 ' + tx + ' 1 0 0 0 0 0 0\n';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playback-fixture-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const put = (name, value) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, String(value));
  };
  put('proc/stat', 'cpu 100 0 50 800 50 0 0 0 10 0\n');
  put('proc/meminfo', 'MemTotal: 16000 kB\nMemAvailable: 4000 kB\nMemFree: 1000 kB\nBuffers: 100 kB\nCached: 2000 kB\nSwapTotal: 4000 kB\nSwapFree: 500 kB\n');
  put('proc/vmstat', 'oom_kill 2\npswpin 10\npswpout 20\npgmajfault 3\npgscan_kswapd 40\npgscan_direct 10\npgsteal_kswapd 30\npgsteal_direct 5\nprivate_counter 999\n');
  put('proc/diskstats', '8 0 private-disk 1 0 20 0 2 0 40 0 0 0 0\n');
  put('proc/net/dev', network());
  put('proc/123/cgroup', '0::/docker/private-container-id\n');
  put('proc/123/net/dev', network());
  put('cgroup/docker/private-container-id/cpu.stat', 'usage_usec 1000000\nuser_usec 600000\nsystem_usec 400000\nnr_periods 10\nnr_throttled 1\nthrottled_usec 100\n');
  put('cgroup/docker/private-container-id/memory.current', 1048576);
  put('cgroup/docker/private-container-id/memory.peak', 2097152);
  put('cgroup/docker/private-container-id/memory.swap.current', 4096);
  put('cgroup/docker/private-container-id/memory.swap.peak', 8192);
  put('cgroup/docker/private-container-id/memory.stat', 'anon 100000\nfile 200000\npgscan 40\npgsteal 30\n');
  put('cgroup/docker/private-container-id/memory.events', 'low 0\nhigh 1\nmax 2\noom 1\noom_kill 1\n');
  put('cgroup/docker/private-container-id/io.stat', '8:0 rbytes=4096 wbytes=8192 rios=1 wios=2\n');
  for (const kind of ['cpu', 'memory', 'io']) {
    put('proc/pressure/' + kind, psi);
    put('cgroup/docker/private-container-id/' + kind + '.pressure', psi);
  }
  const row = {name: '/fixture-server', id: 'a'.repeat(64), pid: 123, started: '2026-11-09T00:00:00Z',
    status: 'running', health: 'healthy', oom_killed: false, restarts: 0};
  put('docker.json', JSON.stringify(row) + '\n');
  put('bin/docker', '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FIXTURE_DIR/calls"\nwhile IFS= read -r line; do printf "%s\\n" "$line"; done < "$FIXTURE_DIR/docker.json"\n');
  fs.chmodSync(path.join(dir, 'bin/docker'), 0o755);
  const env = {PATH: path.join(dir, 'bin') + ':' + process.env.PATH, FIXTURE_DIR: dir};
  const args = ['--duration', '1.2', '--interval', '0.4', '--container', 'ts=fixture-server',
    '--proc-root', path.join(dir, 'proc'), '--cgroup-root', path.join(dir, 'cgroup')];
  return {dir, put, row, env, args};
}

function runPython(f, body) {
  const result = spawnSync('python3', ['-B', '-c', `
import importlib.util, json, os, subprocess
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('measurement', ${JSON.stringify(companion)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
base = Path(os.environ['FIXTURE_DIR'])
c = m.Collector(base / 'proc', base / 'cgroup', {'ts': 'fixture-server'})
row = json.loads((base / 'docker.json').read_text())
def put(name, value):
    (base / name).write_text(str(value))
${body}
`], {env: f.env, encoding: 'utf8', timeout: 5000});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function run(f, extra = []) {
  const started = performance.now();
  const result = spawnSync('bash', [script, ...f.args, ...extra], {env: f.env, encoding: 'utf8', timeout: 5000});
  assert.ifError(result.error);
  return {...result, elapsed: performance.now() - started,
    records: result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))};
}

test('shell syntax, CI wiring and private-artifact exclusion', () => {
  const syntax = spawnSync('bash', ['-n', script], {encoding: 'utf8'});
  assert.equal(syntax.status, 0, syntax.stderr);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/tests.yaml'), 'utf8');
  assert.match(workflow, /node --test tests\/playback-measurement.test.cjs/);
  assert.match(workflow, /bash -n devops\/measure-playback.sh/);
  const ignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
  for (const directory of ['devops', 'docs', 'tests']) assert.ok(ignore.split('\n').includes(directory));
});

test('bounded CLI emits UTC metadata, samples and summary with real fixture parsing', t => {
  const f = fixture(t), result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.elapsed < 2500, result.elapsed);
  assert.equal(result.records[0].type, 'metadata');
  assert.deepEqual(result.records[0].containers, ['ts']);
  const samples = result.records.filter(row => row.type === 'sample');
  assert.ok(samples.length >= 2 && samples.length <= 4, samples.length);
  for (const sample of samples) {
    assert.equal(sample.schema_version, 1);
    assert.match(sample.timestamp, /^\d{4}-\d\d-\d\dT.*\+00:00$/);
    assert.deepEqual(sample.unavailable, []);
    assert.equal(sample.host.memory.used_bytes, 12000 * 1024);
    assert.equal(sample.host.memory.swap_used_bytes, 3500 * 1024);
    assert.equal(sample.host.vm_counters.oom_kill, 2);
    assert.equal(sample.host.cpu.counters.total_ticks, 1000);
    assert.equal(sample.host.disk['8:0'].counters.read_bytes, 20 * 512);
    assert.equal(sample.host.pressure.memory.some.avg10, 1.25);
    assert.equal(sample.containers.ts.health, 'healthy');
    assert.equal(sample.containers.ts.metrics.memory_peak_bytes, 2097152);
    assert.equal(sample.containers.ts.metrics.memory_events.oom_kill, 1);
    assert.equal(sample.containers.ts.metrics.network_counters.rx_bytes, 100);
  }
  assert.equal(samples[0].containers.ts.metrics.cpu_percent, null);
  assert.equal(samples[1].containers.ts.metrics.cpu_percent, 0);
  assert.equal(result.records.at(-1).type, 'summary');
  assert.equal(result.records.at(-1).reason, 'duration');
  const calls = fs.readFileSync(path.join(f.dir, 'calls'), 'utf8').trim().split('\n');
  assert.equal(calls.length, samples.length);
  for (const call of calls) {
    assert.match(call, /^inspect --type container --format /);
    assert.doesNotMatch(call, /\.Config|\.Log|\.Error|\.Health\.Log/);
  }
});

test('host and container counter rates have explicit units and sampled peak memory', t => {
  const values = runPython(fixture(t), `
a = c.host(m.Reader(), 10)
x = c.container('ts', row, m.Reader(), 10)
put('proc/stat', 'cpu 200 0 100 850 50 0 0 0 10 0\\n')
put('proc/meminfo', 'MemTotal: 16000 kB\\nMemAvailable: 3000 kB\\nSwapTotal: 4000 kB\\nSwapFree: 500 kB\\n')
put('proc/vmstat', 'oom_kill 3\\npswpin 14\\npswpout 26\\n')
put('cgroup/docker/private-container-id/cpu.stat', 'usage_usec 3000000\\n')
put('cgroup/docker/private-container-id/io.stat', '8:0 rbytes=8192 wbytes=16384 rios=3 wios=4\\n')
put('cgroup/docker/private-container-id/memory.events', 'oom_kill 3\\n')
put('cgroup/docker/private-container-id/memory.stat', 'pgscan 60\\npgsteal 40\\n')
put('proc/diskstats', '8 0 secret-disk 1 0 24 0 2 0 48 0 0 0 0\\n')
for name in ['proc/net/dev', 'proc/123/net/dev']:
    put(name, 'head\\nhead\\n private-interface: 1100 0 0 0 0 0 0 0 2200 0 0 0 0 0 0 0\\n')
b = c.host(m.Reader(), 12)
y = c.container('ts', row, m.Reader(), 12)
print(json.dumps({'host': b, 'container': y}))`);
  assert.equal(values.host.cpu.busy_percent, 75);
  assert.equal(values.host.memory.sampled_peak_used_bytes, 13000 * 1024);
  assert.equal(values.host.vm_per_second.pswpin, 2);
  assert.equal(values.host.vm_per_second.oom_kill, 0.5);
  assert.equal(values.container.metrics.cpu_percent, 100);
  assert.equal(values.container.metrics.io_per_second.rbytes, 2048);
  assert.equal(values.host.disk['8:0'].bytes_per_second.read_bytes, 1024);
  assert.equal(values.host.network.if1.bytes_per_second.rx_bytes, 500);
  assert.equal(values.container.metrics.network_bytes_per_second.tx_bytes, 1000);
  assert.equal(values.container.metrics.memory_events_per_second.oom_kill, 1);
  assert.equal(values.container.metrics.memory_stat_per_second.pgscan, 10);
});

for (const change of ['restart', 'replacement', 'cgroup', 'inode', 'disappeared']) {
  test('container generation and rate baseline reset after ' + change, t => {
    const mutation = {
      restart: "row['started'] = '2026-11-09T01:00:00Z'; row['restarts'] = 1",
      replacement: "row['id'] = 'b' * 64",
      cgroup: "put('proc/123/cgroup', '0::/docker/new-group\\n'); (base / 'cgroup/docker/new-group').mkdir()",
      inode: "(base / 'cgroup/docker/private-container-id').rename(base / 'cgroup/docker/retired'); (base / 'cgroup/docker/private-container-id').mkdir()",
      disappeared: "c.container('ts', None, m.Reader(), 11)"
    }[change];
    const result = runPython(fixture(t), `
a = c.container('ts', row, m.Reader(), 10)
${mutation}
b = c.container('ts', row, m.Reader(), 12)
print(json.dumps({'a': a, 'b': b}))`);
    assert.equal(result.a.generation, 1);
    assert.equal(result.b.generation, 2);
    assert.equal(result.b.metrics.cpu_percent, null);
  });
}

test('counter decreases and missing reads never produce negative or bridged rates', t => {
  const result = runPython(fixture(t), `
r = m.Rates()
a = r.get('key', {'x': 100}, 1)
b = r.get('key', {'x': 10}, 2)
c = r.get('key', None, 3)
d = r.get('key', {'x': 1000}, 4)
print(json.dumps([a, b, c, d]))`);
  assert.deepEqual(result, [{x: null}, {x: null}, null, {x: null}]);
});

for (const kind of ['missing', 'malformed', 'v1', 'root', 'escape', 'stopped']) {
  test('unavailable metrics are explicit for ' + kind, t => {
    const f = fixture(t);
    if (kind === 'missing') fs.unlinkSync(path.join(f.dir, 'cgroup/docker/private-container-id/memory.peak'));
    if (kind === 'malformed') f.put('proc/pressure/memory', 'private-malformed-output');
    if (kind === 'v1') f.put('proc/123/cgroup', '5:memory:/docker/private-id\n');
    if (kind === 'root') f.put('proc/123/cgroup', '0::/\n');
    if (kind === 'escape') f.put('proc/123/cgroup', '0::/../../outside\n');
    if (kind === 'stopped') { f.row.status = 'exited'; f.row.pid = 0; f.put('docker.json', JSON.stringify(f.row) + '\n'); }
    const result = run(f), sample = result.records.find(row => row.type === 'sample');
    assert.equal(result.status, 0, result.stderr);
    const labels = {missing: 'containers.ts.memory_peak', malformed: 'host.pressure.memory',
      v1: 'containers.ts.cgroup_v2', root: 'containers.ts.cgroup_v2', escape: 'containers.ts.cgroup_v2',
      stopped: 'containers.ts.cgroup_v2'};
    assert.ok(sample.unavailable.includes(labels[kind]), sample.unavailable);
    if (kind === 'missing') assert.equal(sample.containers.ts.metrics.memory_peak_bytes, null);
    if (kind === 'malformed') assert.equal(sample.host.pressure.memory, null);
    if (['v1', 'root', 'escape', 'stopped'].includes(kind)) assert.equal(sample.containers.ts.metrics, null);
  });
}

test('PID cgroup change during collection discards mixed metrics', t => {
  const result = runPython(fixture(t), `
r = m.Reader()
original = r.text
calls = 0
def changing(path, label):
    global calls
    if str(path).endswith('/123/cgroup'):
        calls += 1
        if calls == 2:
            return '0::/docker/restarted\\n'
    return original(path, label)
r.text = changing
sample = c.container('ts', row, r, 10)
print(json.dumps({'sample': sample, 'missing': sorted(r.unavailable)}))`);
  assert.equal(result.sample.metrics, null);
  assert.ok(result.missing.includes('containers.ts.generation_changed_during_sample'));
});

for (const mode of ['partial', 'malformed', 'invalid-state', 'unavailable', 'timeout']) {
  test('Docker ' + mode + ' failures stay bounded and redact diagnostics', t => {
    const f = fixture(t);
    if (mode === 'partial') f.put('bin/docker', '#!/bin/sh\nwhile IFS= read -r line; do printf "%s\\n" "$line"; done < "$FIXTURE_DIR/docker.json"\necho private-token >&2\nexit 1\n');
    if (mode === 'malformed') f.put('docker.json', 'private-token is not JSON\n');
    if (mode === 'invalid-state') { f.row.health = 'private-token'; f.put('docker.json', JSON.stringify(f.row) + '\n'); }
    if (mode === 'unavailable') f.put('bin/docker', '#!/bin/sh\necho private-token >&2\nexit 127\n');
    // exec prevents a surviving shell child; the collector must kill its timed-out Docker child.
    if (mode === 'timeout') f.put('bin/docker', '#!/bin/sh\nexec sleep 5\n');
    const result = run(f);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.elapsed < 2500, result.elapsed);
    assert.doesNotMatch(result.stdout + result.stderr, /private-token/);
    const sample = result.records.find(row => row.type === 'sample');
    assert.ok(sample.unavailable.length > 0);
    assert.equal(sample.containers.ts.available, mode === 'partial');
    if (mode === 'timeout') assert.ok(sample.unavailable.includes('docker.timeout'));
  });
}

test('all missing host files and a missing Docker executable produce useful partial samples', t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.dir, 'proc'), {recursive: true});
  const result = runPython(f, `
with patch.object(m.subprocess, 'run', side_effect=FileNotFoundError('private path')):
    sample = c.sample(m.time.monotonic() + 1)
print(json.dumps(sample))`);
  assert.equal(result.host.memory, null);
  assert.equal(result.host.disk, null);
  assert.equal(result.host.network, null);
  assert.equal(result.containers.ts.available, false);
  assert.ok(result.unavailable.includes('docker.unavailable'));
});

test('annotations accept bounded events and reject private identifiers without echoing input', t => {
  const f = fixture(t);
  const valid = {offset_seconds: 0, event: 'start', client: 'v1', bitrate_mbps: 12.5, viewers: 3,
    platform: 'android', player: 'external', route: 'tailnet', workload: 'distinct_1080p'};
  const invalid = [
    {...valid, title: 'PRIVATE-MOVIE'}, {...valid, client: 'PRIVATE-DEVICE'},
    {...valid, offset_seconds: -1}, {...valid, offset_seconds: 999},
    {...valid, bitrate_mbps: Infinity}, {...valid, bitrate_mbps: 'PRIVATE-KEY'},
    {...valid, event: 'PRIVATE-URL'}, {...valid, viewers: 1.5}, {...valid, route: []},
    {...valid, platform: 'PRIVATE-USER'}, {...valid, player: 'PRIVATE-PATH'},
  ];
  f.put('annotations.jsonl', [valid, {...valid, offset_seconds: 0.2, event: 'seek'}, ...invalid]
    .map(value => JSON.stringify(value)).join('\n') + '\nPRIVATE-BROKEN-JSON\n');
  const result = run(f, ['--annotations', path.join(f.dir, 'annotations.jsonl')]);
  assert.equal(result.status, 0, result.stderr);
  const events = result.records.filter(row => row.type === 'annotation');
  assert.equal(events.length, 2);
  assert.equal(events[0].bitrate_mbps, 12.5);
  assert.equal(events[1].event, 'seek');
  assert.ok(result.records.at(-1).unavailable.includes('annotations.invalid_record'));
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE|fixture-server|private-interface|private-disk|private-container-id|a{64}/);
});

test('annotation appends, partial lines, deduplication, missing and oversized files', t => {
  const result = runPython(fixture(t), `
p = base / 'annotations.jsonl'
a = m.Annotations(p)
missing = a.read(0, 10)
p.write_text('{"offset_seconds":0,"event":"start","client":"v1"}')
partial = a.read(0, 10)
with p.open('a') as out:
    out.write('\\n')
first = a.read(1, 10)
again = a.read(2, 10)
p.write_bytes(b'x' * 1048577)
large = a.read(3, 10)
print(json.dumps([missing, partial, first, again, large]))`);
  assert.deepEqual(result[0], [[], ['annotations.unavailable']]);
  assert.deepEqual(result[1], [[], []]);
  assert.equal(result[2][0].length, 1);
  assert.deepEqual(result[3], [[], []]);
  assert.deepEqual(result[4], [[], ['annotations.too_large']]);
});

for (const options of [
  ['--unknown', 'PRIVATE'], ['--duration', 'PRIVATE'], ['--duration', '0'], ['--duration', '86401'], ['--duration', 'nan'], ['--interval', '0'],
  ['--interval', '61'], ['--container', 'x=../PRIVATE'], ['--container', 'missing-equals'],
  ['--container', 'x=a', '--container', 'x=b'], ['--container', 'x=a', '--container', 'y=a'],
]) {
  test('invalid options fail before Docker access: ' + options.join(' '), t => {
    const f = fixture(t), result = run(f, options);
    assert.equal(result.status, 2);
    assert.equal(result.records.length, 0);
    assert.ok(!fs.existsSync(path.join(f.dir, 'calls')));
    assert.doesNotMatch(result.stderr, /PRIVATE/);
  });
}

test('termination signals finish with a summary and leave no continuing collection', async t => {
  const f = fixture(t);
  const child = spawn('bash', [script, ...f.args, '--duration', '20'], {env: f.env, stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => child.kill('SIGKILL'));
  let output = '', errors = '', signalled = false;
  child.stderr.on('data', data => { errors += data; });
  child.stdout.on('data', data => {
    output += data;
    // Signal once; summary output must not trigger another signal during process exit.
    if (!signalled && output.includes('"type":"sample"')) {
      signalled = true;
      child.kill('SIGTERM');
    }
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  const status = await new Promise(resolve => child.on('close', (code, signal) => resolve({code, signal})));
  clearTimeout(timer);
  assert.equal(status.code, 0, errors);
  const rows = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.at(-1).reason, 'signal');
});

test('individual missing CPU, OOM and VM counters are named explicitly', t => {
  const result = runPython(fixture(t), `
put('proc/vmstat', 'pswpin 0\\n')
put('cgroup/docker/private-container-id/cpu.stat', 'user_usec 100\\n')
put('cgroup/docker/private-container-id/memory.events', 'high 0\\n')
r = m.Reader()
c.host(r, 10)
x = c.container('ts', row, r, 10)
print(json.dumps({'sample': x, 'missing': sorted(r.unavailable)}))`);
  for (const label of ['host.vm.oom_kill', 'host.vm.pswpout', 'containers.ts.cpu.usage_usec', 'containers.ts.memory_events.oom_kill']) {
    assert.ok(result.missing.includes(label), result.missing);
  }
  assert.equal(result.sample.metrics.cpu_percent, null);
});

test('network alias identity survives reordering and resets after device disappearance', t => {
  const result = runPython(fixture(t), `
header = 'head\\nhead\\n'
first = ' secret-a: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0\\n'
second = ' secret-b: 300 0 0 0 0 0 0 0 400 0 0 0 0 0 0 0\\n'
put('proc/net/dev', header + first + second)
a = c.host(m.Reader(), 10)['network']
put('proc/net/dev', header + second + first)
b = c.host(m.Reader(), 11)['network']
put('proc/net/dev', header + second)
c.host(m.Reader(), 12)
put('proc/net/dev', header + first + second)
d = c.host(m.Reader(), 13)['network']
print(json.dumps([a, b, d]))`);
  assert.equal(result[0].if1.counters.rx_bytes, 100);
  assert.equal(result[1].if1.counters.rx_bytes, 100);
  assert.equal(result[1].if1.bytes_per_second.rx_bytes, 0);
  assert.equal(result[2].if1.bytes_per_second.rx_bytes, null);
});

test('collector honors the remaining deadline and never inspects after it', t => {
  const result = runPython(fixture(t), `
r = m.Reader()
c.clock = lambda: 10
with patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as command:
    c.inspect(10.25, r)
    timeout = command.call_args.kwargs['timeout']
    c.inspect(10, r)
    count = command.call_count
print(json.dumps({'timeout': timeout, 'calls': count, 'missing': sorted(r.unavailable)}))`);
  assert.equal(result.timeout, 0.25);
  assert.equal(result.calls, 1);
  assert.ok(result.missing.includes('docker.deadline'));
});

test('annotation FIFOs and deeply nested or huge numbers cannot block or leak errors', t => {
  const result = runPython(fixture(t), `
p = base / 'annotation-pipe'
os.mkfifo(p)
fifo = m.Annotations(p).read(0, 10)
p.unlink()
p.write_text('[' * 1100 + '0' + ']' * 1100 + '\\n' + '{"offset_seconds":0,"event":"start","client":"v1","bitrate_mbps":' + '9' * 1000 + '}\\n')
invalid = m.Annotations(p).read(0, 10)
print(json.dumps([fifo, invalid]))`);
  assert.deepEqual(result[0], [[], ['annotations.not_regular_file']]);
  assert.deepEqual(result[1], [[], ['annotations.invalid_record']]);
});

test('too many targets fail without inspection', t => {
  const f = fixture(t), extra = [];
  for (let i = 0; i < 17; i++) extra.push('--container', 'c' + i + '=fixture' + i);
  const result = run(f, extra);
  assert.equal(result.status, 2);
  assert.ok(!fs.existsSync(path.join(f.dir, 'calls')));
});

test('document links, shell examples, JSON examples and annotation schema remain valid', t => {
  const doc = fs.readFileSync(path.join(root, 'docs/parallel-playback-validation.md'), 'utf8');
  for (const match of doc.matchAll(/\]\(([^)]+)\)/g)) {
    if (!match[1].includes('://')) assert.ok(fs.existsSync(path.resolve(root, 'docs', match[1])), match[1]);
  }
  for (const match of doc.matchAll(/```sh\n([\s\S]*?)```/g)) {
    const result = spawnSync('bash', ['-n'], {input: match[1], encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
  }
  const examples = [...doc.matchAll(/```jsonl\n([\s\S]*?)```/g)]
    .map(match => match[1].trim().split('\n').map(line => JSON.parse(line)));
  assert.equal(examples.length, 2);
  const f = fixture(t);
  f.put('documentation-events.jsonl', examples[0].map(row => JSON.stringify(row)).join('\n') + '\n');
  const values = runPython(f, `
a = m.Annotations(base / 'documentation-events.jsonl').read(120, 4200)
print(json.dumps(a))`);
  assert.equal(values[0].length, 3);
  assert.deepEqual(values[1], []);
  for (const row of examples[1]) {
    assert.equal(row.schema_version, 1);
    assert.ok(['metadata', 'sample', 'summary'].includes(row.type));
  }
});
