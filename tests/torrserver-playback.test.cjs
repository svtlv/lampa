// Execute the shipped lifecycle functions with controlled requests, time and clients.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const bundle = fs.readFileSync(path.join(__dirname, '../app.min.js'), 'utf8');
const source = bundle.slice(bundle.indexOf('  var SERVER = {};'), bundle.indexOf('\n  function Results('));
const apiSource = bundle.slice(bundle.indexOf('  var network$c = new Request();'), bundle.indexOf('\n  /**', bundle.indexOf('  var Torserver = {')));
function fn(name) {
  const start = bundle.indexOf('\n  function ' + name + '(') + 1;
  assert.ok(start > 0, name);
  return bundle.slice(start, bundle.indexOf('\n  }', start) + 4);
}
function server() {
  return {drops: [], readers: new Set(), saved: new Set(['shared']),
    play(client) { this.readers.add(client); },
    drop(hash) { this.drops.push(hash); this.readers.clear(); }};
}
function page(shared = server()) {
  let now = 0, serial = 0;
  const timers = new Map(), requests = [], modals = [], updates = [], shown = [], lists = [], events = [];
  const history = [], timeline = [], played = [], progress = [], controllers = [], keys = new Set(), seasons = [];
  const settings = {torrserver_url: 'http://server', torrserver_preload: true, internal_torrclient: true};
  const loaders = [], playerBacks = [];
  let stopCount = 0;
  const schedule = (call, delay, interval) => { const id = ++serial; timers.set(id, {call, delay, at: now + delay, interval}); return id; };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry;
      now = timer.at;
      if (timer.interval) timer.at += timer.delay; else timers.delete(id);
      timer.call();
    }
    now = end;
  }
  function Request() {
    const owner = this;
    this.timeout = () => {};
    this.clear = () => { requests.filter(r => r.owner === owner).forEach(r => { r.cleared = true; }); };
    this.errorDecode = () => 'request error';
    this.silent = (url, success, fail, body) => {
      const data = body && JSON.parse(body);
      const request = {owner, url, data, cleared: false,
        // Deliberately deliver callbacks even after clear, modelling already queued work.
        success: value => success && success(value), fail: () => fail && fail()};
      requests.push(request);
      if (data?.action === 'drop') shared.drop(data.hash);
    };
  }
  function node() {
    const handlers = {};
    const result = {0: {}, length: 1, handlers,
      on(name, call) { handlers[name] = call; return result; },
      trigger(name) { handlers[name]?.(); return result; },
      find: () => node(), attr: () => '', hasClass: () => false};
    for (const name of ['append', 'prepend', 'remove', 'empty', 'text', 'html', 'css', 'addClass', 'removeClass', 'toggleClass']) result[name] = () => result;
    return result;
  }
  const context = vm.createContext({Request,
    Date: {now: () => now}, setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id),
    setTimeout: (fn, ms) => schedule(fn, ms, false), clearTimeout: id => timers.delete(id),
    $: node, navigator: {userAgent: 'browser'},
    Storage: {get: key => settings[key] || '', field: key => settings[key], value: key => settings[key] || ''},
    Platform: {is: name => settings.platform === name, install() {}},
    Android: {openTorrent: value => played.push(value), playHash: value => played.push(value)},
    Favorite: {add: (...args) => history.push(args)},
    Template: {get: (name, data) => ({name, data, ...node()})},
    Lang: {translate: key => key},
    Modal: {open: data => modals.push(data), close() {}, update: data => updates.push(data), title() {}, scroll: () => ({render: node})},
    Controller: {toggle: name => controllers.push(name), enabled: () => ({name: 'modal'}), collectionFocus() {}},
    Loading$1: {start: cancel => loaders.push(cancel), stop: () => stopCount++, setProgress: (...args) => progress.push(args)},
    Utils$1: {checkEmptyUrl: value => value, bytesToSize: value => String(value), clearCard: v => v},
    Arrays: {clone: v => ({...v}), extend: (a, b) => Object.assign(a, b)},
    Keypad: {listener: {follow: (name, call) => keys.add(call), remove: (name, call) => keys.delete(call)}},
    Lampa: {Listener: {send: (name, data) => events.push(data)}},
    Activity: {active: () => ({movie: {title: 'movie'}})},
    Api: {seasons: (movie, names, call) => seasons.push(call)},
    Timeline$2: {view: hash => ({hash, percent: 25}), link: () => 'local', render: node, update: view => timeline.push(view)},
    subsrt: {list: () => []},
    Player: {play: element => { played.push(element); shared.play(context); }, callback: call => playerBacks.push(call), playlist() {}},
    Select: {show() {}}, Noty: {show() {}}, EpisodeParser: {parse: () => ({})}
  });
  vm.runInContext(apiSource + '\n' + source, context);
  const actualShow = context.show$3, actualList = context.list$2;
  context.show$3 = files => shown.push(files);
  context.list$2 = (...args) => lists.push(args);
  context.Torserver.parse = () => ({hash: 'local-position', by_title: true, serial: false});
  context.Torserver.clearFileName = files => files;
  return {context, shared, settings, timers, requests, modals, updates, shown, lists, events, loaders, progress, controllers,
    keys, seasons, history, timeline, played, playerBacks, node, advance, actualShow, actualList, get stopCount() { return stopCount; },
    pending(action) { return requests.filter(r => r.data?.action === action); },
    open(hash = 'shared') { context.Torrent.open(hash); },
    preload(run = () => played.push('run'), url = 'http://server/stream/movie?link=shared&index=1&preload') { context.preload({url}, run); }
  };
}
const files = [{path: 'movie.mkv', path_human: 'movie', id: 1, length: 100}];

test('dialog close clears local discovery without dropping a shared hash', () => {
  const p = page(); p.shared.play('other'); p.open(); p.advance(2000);
  const request = p.pending('get')[0];
  p.modals[0].onBack(); request.success({file_stats: files}); p.advance(120000);
  assert.deepEqual(p.shared.drops, []);
  assert.ok(p.shared.readers.has('other'));
  assert.equal(p.timers.size, 0); assert.equal(request.cleared, true);
  assert.equal(p.shown.length, 0); assert.equal(p.controllers.at(-1), 'content');
  assert.equal(p.events.filter(e => e.type === 'list_close').length, 1);
});

test('discovery timeout is terminal, reports once and ignores late responses', () => {
  const p = page(); p.shared.play('other'); p.open(); p.advance(90000);
  assert.equal(p.updates.length, 1);
  assert.equal(p.updates[0].data.text, 'torrent_parser_timeout');
  assert.equal(p.timers.size, 0);
  p.pending('get').forEach(r => { assert.equal(r.cleared, true); r.success({file_stats: files}); r.fail(); });
  p.advance(120000);
  assert.equal(p.shown.length, 0); assert.equal(p.updates.length, 1);
  assert.deepEqual(p.shared.drops, []); assert.ok(p.shared.readers.has('other'));
  p.modals[0].onBack(); assert.equal(p.controllers.at(-1), 'content');
});

test('discovery success ends polling and accepts only one completion', () => {
  const p = page(); p.open(); p.advance(2000); const r = p.pending('get')[0];
  r.success({file_stats: files}); r.success({file_stats: files}); r.fail(); p.advance(100000);
  assert.equal(p.shown.length, 1); assert.equal(p.timers.size, 0); assert.equal(p.updates.length, 0);
});

test('discovery errors and missing metadata retry until success', () => {
  const p = page(); p.open(); p.advance(2000); p.pending('get')[0].fail();
  p.advance(2000); p.pending('get')[1].success({});
  p.advance(2000); p.pending('get')[2].success({file_stats: files});
  assert.equal(p.shown.length, 1); assert.equal(p.timers.size, 0);
});

for (const closeFirst of [false, true]) test('replacement/reopen fences old discovery and old dialog back: ' + closeFirst, () => {
  const p = page(); p.open('old'); p.advance(2000); const old = p.pending('get')[0], back = p.modals[0].onBack;
  if (closeFirst) back();
  p.open('new'); old.success({file_stats: files}); back(); p.advance(2000);
  const latest = p.pending('get').at(-1); assert.equal(latest.data.hash, 'new');
  latest.success({file_stats: files}); assert.equal(p.shown.length, 1);
  assert.equal(p.context.SERVER.hash, 'new'); assert.equal(p.timers.size, 0);
});

for (const phase of ['connect', 'hash']) test('late ' + phase + ' success/error cannot affect a replacement', () => {
  const p = page(); p.context.Torrent.start({title: 'old', MagnetUri: 'magnet:old'}, {title: 'old movie'});
  const connected = p.pending('get')[0];
  if (phase === 'hash') connected.success({CacheSize: 1});
  const stale = phase === 'hash' ? p.pending('add')[0] : connected;
  p.open('new'); stale.success({hash: 'old', CacheSize: 1}); stale.fail();
  assert.equal(p.pending('add').length, phase === 'hash' ? 1 : 0);
  assert.equal(p.context.SERVER.hash, 'new'); assert.equal(p.context.SERVER.movie, undefined);
  assert.equal(p.updates.length, 0); assert.equal(p.timers.size, 1);
});

test('successful connect/hash/discovery retains movie metadata', () => {
  const p = page(); p.context.Torrent.start({title: 'movie', MagnetUri: 'magnet:movie'}, {id: 12});
  p.pending('get')[0].success({CacheSize: 1}); p.pending('add')[0].success({hash: 'shared'});
  p.advance(2000); p.pending('get').at(-1).success({file_stats: files});
  assert.equal(p.context.SERVER.movie.id, 12); assert.equal(p.shown.length, 1);
});

test('season metadata arriving after replacement cannot render the old list', () => {
  const p = page(); p.open(); p.context.Torserver.parse = () => ({serial: true, season: 1});
  p.actualShow(files); p.open('new'); p.seasons[0]({}); assert.equal(p.lists.length, 0);
});

test('close removes autostart timer, progress and key listener', () => {
  const p = page(); p.open(); let entered = 0;
  p.context.autostart({prepend() {}, trigger() { entered++; }});
  assert.equal(p.keys.size, 1); p.modals[0].onBack(); p.advance(12000);
  assert.equal(p.keys.size, 0); assert.equal(p.timers.size, 0); assert.equal(entered, 0);
});

test('back callback can open a new dialog without the old close clearing it', () => {
  const p = page(); p.open(); p.context.Torrent.back(() => p.open('new')); p.modals[0].onBack();
  assert.equal(p.context.SERVER.hash, 'new'); assert.equal(p.timers.size, 1);
});

for (const end of ['cancel', 'close', 'replace', 'new-preload']) test('preload ' + end + ' rejects late success/error and queued polling', () => {
  const p = page(); p.open(); p.preload(); const old = p.requests.at(-1), cancel = p.loaders[0];
  old.success({preloaded_bytes: 10, preload_size: 100});
  const update = [...p.timers.values()].find(t => !t.interval).call;
  if (end === 'cancel') cancel();
  if (end === 'close') p.modals[0].onBack();
  if (end === 'replace') p.open('new');
  if (end === 'new-preload') p.preload();
  const count = p.requests.length, stopped = p.stopCount;
  update(); old.success({preloaded_bytes: 100, preload_size: 100}); old.fail(); cancel();
  assert.equal(p.requests.length, count); assert.equal(p.played.length, 0); assert.equal(p.stopCount, stopped);
  assert.equal(old.cleared, true); assert.deepEqual(p.shared.drops, []);
});

test('preload completion runs once, uses stat after initial request and clears timer', () => {
  const p = page(); p.preload(); assert.ok(p.requests[0].url.endsWith('&preload'));
  p.requests[0].success({preloaded_bytes: 10, preload_size: 100}); p.advance(1000);
  const ready = p.requests[1]; assert.ok(ready.url.endsWith('&stat'));
  ready.success({preloaded_bytes: 95, preload_size: 100}); ready.success({preloaded_bytes: 100, preload_size: 100}); ready.fail();
  assert.equal(p.played.length, 1); assert.equal(p.timers.size, 0); assert.equal(p.stopCount, 1);
});

for (const errors of [false, true]) test('preload stops after 30 seconds without progress: errors=' + errors, () => {
  const p = page(); p.preload();
  for (let i = 0; i < 32; i++) {
    if (errors) p.requests.at(-1).fail(); else p.requests.at(-1).success({preloaded_bytes: 1, preload_size: 100});
    p.advance(1000);
  }
  assert.equal(p.timers.size, 0); assert.equal(p.played.length, 0); assert.equal(p.stopCount, 1);
});

test('preload progress extends the idle deadline; direct play bypasses loader', () => {
  const p = page(); p.preload();
  for (let i = 1; i <= 35; i++) { p.requests.at(-1).success({preloaded_bytes: i, preload_size: 100}); p.advance(1000); }
  assert.equal(p.stopCount, 0);
  p.requests.at(-1).success({preloaded_bytes: 100, preload_size: 100}); assert.equal(p.played.length, 1);
  p.preload(undefined, 'http://server/stream?link=shared&play'); assert.equal(p.played.length, 2);
  assert.equal(p.loaders.length, 1);
});

test('two clients sharing a hash survive one dialog close, timeout and preload cancellation', () => {
  const shared = server(), a = page(shared), b = page(shared);
  a.preload(() => { shared.play('a'); }); a.requests[0].success({preload_size: 100, preloaded_bytes: 100});
  b.open(); b.advance(2000); b.modals[0].onBack();
  b.open(); b.advance(90000); b.preload(); b.loaders.at(-1)();
  assert.ok(shared.readers.has('a')); assert.deepEqual(shared.drops, []); assert.ok(shared.saved.has('shared'));
  a.context.Torserver.drop('shared'); assert.deepEqual(shared.drops, ['shared']); assert.equal(shared.readers.size, 0);
  assert.ok(shared.saved.has('shared'), 'drop remains distinct from removing a saved record');
});

test('actual file list retains local Timeline and playback callbacks', () => {
  const p = page(); p.open(); const item = {...files[0]};
  // Capture the actual item rather than synthesizing a replacement enter handler.
  const get = p.context.Template.get;
  let fileNode;
  p.context.Template.get = (name, data) => { const node = get(name, data); if (name === 'torrent_file_serial') fileNode = node; return node; };
  p.actualList([item], {movie: {id: 12, title: 'movie'}, files: [item]});
  assert.equal(item.timeline.hash, 'local-position'); assert.equal(item.timeline.percent, 25);
  let opened = 0; p.context.Torrent.opened(() => opened++);
  fileNode.trigger('hover:enter'); p.requests.at(-1).success({preloaded_bytes: 100, preload_size: 100});
  assert.equal(p.played[0], item); assert.equal(opened, 1); assert.equal(p.history.length, 1);
  assert.equal(p.events.filter(e => e.type === 'onenter').length, 1);
  assert.equal(p.timeline.length, 0, 'playback must not reset local Timeline');
});

function playerInfo(p) {
  const elems = Object.fromEntries(['stat', 'speed', 'pieces', 'size', 'error', 'vname', 'name', 'title'].map(k => [k, p.node()]));
  Object.assign(p.context, {elems, html$h: p.node(), listener$a: {send() {}}, network$7: new p.context.Request()});
  const variables = bundle.slice(bundle.indexOf('  var error$1, stat_timer;'), bundle.indexOf('  function init$W()'));
  // Keep any nearby lifecycle state declarations used by these actual functions.
  vm.runInContext(variables + fn('pieces') + fn('stat$3') + fn('destroy$e'), p.context);
  return {start: hash => p.context.stat$3({url: 'http://server/stream/movie?link=' + hash + '&play', torrent_hash: hash}), stop: () => p.context.destroy$e()};
}

test('player statistics replacement leaves one poller and ignores stale nested cache replies', () => {
  const p = page(), info = playerInfo(p); p.context.html$h.hasClass = () => true; info.start('old'); const old = p.requests[0]; old.success({});
  const cache = p.requests[1]; let sent = 0; p.context.listener$a.send = () => sent++;
  info.start('new'); assert.equal(p.timers.size, 1);
  old.success({}); cache.success({Readers: []}); cache.fail(); assert.equal(sent, 0); info.stop(); p.advance(20000); assert.equal(p.timers.size, 0);
});

test('hidden/paused player retains periodic heartbeat and stops it on destroy', () => {
  const p = page(), info = playerInfo(p); info.start('shared'); p.advance(24000);
  assert.equal(p.requests.length, 2, 'hidden panel still polls every twelve seconds');
  const late = p.requests.at(-1); info.stop(); const count = p.requests.length;
  late.success({}); late.fail(); p.advance(24000); assert.equal(p.requests.length, count);
});


test('same-hash repeated opens leave one discovery timer and reject queued old ticks', () => {
  const p = page(); p.open(); const tick = [...p.timers.values()][0].call;
  p.open(); p.open(); const count = p.requests.length; tick();
  assert.equal(p.requests.length, count); assert.equal(p.timers.size, 1);
  p.advance(2000); p.pending('get')[0].success({file_stats: files});
  assert.equal(p.shown.length, 1); assert.equal(p.timers.size, 0);
});

test('discovery accepts a response before the deadline and never overwrites it with timeout', () => {
  const p = page(); p.open(); p.advance(88000);
  p.pending('get').at(-1).success({file_stats: files}); p.advance(20000);
  assert.equal(p.shown.length, 1); assert.equal(p.updates.length, 0); assert.equal(p.timers.size, 0);
});

test('active connection errors retain the existing error UI and can be retried', () => {
  const p = page(); let errors = 0; p.context.Torserver.error = () => errors++;
  const start = () => p.context.Torrent.start({title: 'movie', MagnetUri: 'magnet:movie'});
  start(); p.pending('get')[0].fail(); assert.equal(errors, 1); assert.equal(p.timers.size, 0);
  start(); p.pending('get').at(-1).success({CacheSize: 1});
  p.pending('add')[0].success({hash: 'shared'}); p.advance(2000);
  p.pending('get').at(-1).success({file_stats: files}); assert.equal(p.shown.length, 1);
});

test('active hash errors retain the no-hash UI with no discovery timer', () => {
  const p = page(); p.context.Torrent.start({title: 'movie', MagnetUri: 'magnet:movie'});
  p.pending('get')[0].success({CacheSize: 1}); const add = p.pending('add')[0]; add.fail();
  assert.equal(p.updates[0].name, 'torrent_nohash'); assert.equal(add.cleared, true); assert.equal(p.timers.size, 0);
});

for (const phase of ['connect', 'hash']) test('cancel during ' + phase + ' rejects both late outcomes', () => {
  const p = page(); p.context.Torrent.start({title: 'movie', MagnetUri: 'magnet:movie'});
  const connected = p.pending('get')[0]; if (phase === 'hash') connected.success({CacheSize: 1});
  const request = phase === 'hash' ? p.pending('add')[0] : connected;
  p.modals[0].onBack(); request.success({hash: 'shared', CacheSize: 1}); request.fail();
  assert.equal(p.timers.size, 0); assert.equal(p.updates.length, 0); assert.equal(p.context.SERVER.hash, undefined);
});

test('direct playback supersedes a pending preload and ignores its late completion', () => {
  const p = page(); p.preload(); const old = p.requests[0];
  p.preload(undefined, 'http://server/stream/movie?link=shared&play');
  old.success({preloaded_bytes: 100, preload_size: 100}); old.fail();
  assert.equal(p.played.length, 1); assert.equal(p.stopCount, 1); assert.equal(p.timers.size, 0);
});

test('Android external-player paths still bypass discovery and preload', () => {
  const p = page(); p.settings.platform = 'android'; p.settings.internal_torrclient = false;
  p.context.Torrent.start({title: 'movie', MagnetUri: 'magnet:movie'}, {id: 12});
  p.open('shared'); assert.equal(p.requests.length, 0); assert.equal(p.timers.size, 0);
  assert.equal(p.played.length, 2); assert.equal(p.history.length, 1);
});

test('GStreamer keeps its heartbeat URL and stops polling after destroy', () => {
  const p = page(), info = playerInfo(p); p.context.Torserver.gstWork = () => true;
  p.context.html$h.hasClass = () => true; info.start('shared');
  assert.equal(p.requests[0].url, 'http://server/gst/shared/heartbeat');
  p.requests[0].success({Readers: []}); assert.equal(p.requests.length, 1);
  info.stop(); p.advance(10000); assert.equal(p.requests.length, 1);
});


test('repeated autostart leaves one countdown and rejects queued callbacks after close', () => {
  const p = page(); p.open(); let entered = 0;
  const item = {prepend() {}, trigger() { entered++; }};
  p.context.autostart(item); const oldTick = [...p.timers.values()].find(t => t.delay === 10).call;
  p.context.autostart(item); assert.equal(p.timers.size, 2, 'one discovery and one countdown');
  const newTick = [...p.timers.values()].find(t => t.delay === 10).call;
  p.modals[0].onBack(); p.advance(12000); oldTick(); newTick();
  assert.equal(entered, 0); assert.equal(p.timers.size, 0); assert.equal(p.keys.size, 0);
});

test('detached file enter and old player return cannot affect a reopened dialog', () => {
  const p = page(); p.open(); const item = {...files[0]};
  const get = p.context.Template.get; let fileNode;
  p.context.Template.get = (name, data) => { const node = get(name, data); if (name === 'torrent_file_serial') fileNode = node; return node; };
  p.actualList([item], {movie: {id: 12, title: 'movie'}, files: [item]});
  fileNode.trigger('hover:enter'); p.requests.at(-1).success({preloaded_bytes: 100, preload_size: 100});
  p.open('new'); const requests = p.requests.length, toggles = p.controllers.length;
  fileNode.trigger('hover:enter'); p.playerBacks[0]();
  assert.equal(p.requests.length, requests); assert.equal(p.controllers.length, toggles); assert.equal(p.played.length, 1);
});

test('CI executes playback regressions and checks the edited bundle as ES5', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/tests.yaml'), 'utf8');
  assert.match(workflow, /node --test [^\n]*tests\/torrserver-playback\.test\.cjs/);
  assert.match(workflow, /for script in svtlv\/\*\.js app\.min\.js; do/);
  assert.match(workflow, /acorn@8\.14\.0 --ecma5 --silent "\$script"/);
});
