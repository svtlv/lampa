// Run with: node --test tests/torrserver-one-link.test.cjs
// Executes the actual bundle functions without booting Lampa or contacting a server.
// The historical filename is retained for continuity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const bundle = fs.readFileSync(path.join(__dirname, '../app.min.js'), 'utf8');
const storageExport = bundle.match(/  var Storage = \{([\s\S]*?)\n  \};/);
const storageListener = storageExport[1].match(/\blistener: ([\w$]+)/)[1];
const storageStart = bundle.lastIndexOf('\n  var ' + storageListener + ' = ', storageExport.index);
const storageModule = bundle.slice(storageStart, storageExport.index + storageExport[0].length);
const storageSubscribe = storageModule.match(/var [\w$]+ = ([\w$]+)\(\);/)[1];
const torrserverExport = bundle.match(/  var Torserver = \{([\s\S]*?)\n  \};/)[1];
const torrserverURL = torrserverExport.match(/\burl: ([\w$]+)/)[1];
const torrserverNetwork = source('my').match(/torrserverRequest\(([\w$]+),/)[1];
const routing = bundle.slice(bundle.indexOf('  // svtlv: keep a working TorrServer'), bundle.indexOf('  /**', bundle.indexOf('  // svtlv: keep a working TorrServer')));

function source(name, indent = '  ') {
  const declaration = indent === '  ' ? '\n' + indent + 'function ' + name + '(' : '\n' + indent + name + ': function ' + name + '(';
  const found = bundle.indexOf(declaration);
  assert.ok(found >= 0, 'bundle function exists: ' + name);
  const start = found + 1 + (indent === '  ' ? 0 : indent.length + name.length + 2);
  const end = bundle.indexOf('\n' + indent + '}', start);
  assert.ok(end > start, 'bundle function ends: ' + name);
  return bundle.slice(start, end + indent.length + 2);
}

function device(values = {}, options = {}) {
  const items = {...values};
  const writes = [];
  const notices = [];
  const localStorage = {
    getItem(key) {
      if (options.readError) throw new Error('storage denied');
      return Object.hasOwn(items, key) ? items[key] : null;
    },
    setItem(key, value) {
      writes.push([key, String(value)]);
      const failed = options.fail && options.fail(key, writes.length);
      if (failed === 'throw') throw new Error('storage full');
      if (failed !== 'silent') items[key] = String(value);
    },
    removeItem(key) { delete items[key]; }
  };
  const context = vm.createContext({
    window: {localStorage, location: {protocol: options.protocol || 'https:'}},
    readed: {}, reserve: options.reserve || {},
    Arrays: {isObject: v => !!v && typeof v === 'object' && !Array.isArray(v), isArray: Array.isArray},
    Noty: {show: message => notices.push(message)},
    Base64: {encode: text => Buffer.from(text).toString('base64')},
    values: {}, defaults: {torrserver_auth: false, torrserver_preload: false, torrserver_gts: false}
  });
  // Include Storage's private state/helpers and finish its reserve-loading phase.
  context[storageSubscribe] = () => ({send() {}});
  context.Cache = {getData: () => ({then(next) { next([]); return {catch() {}}; }})};
  vm.runInContext(storageModule, context);
  context.reserve = options.reserve || {};
  context.Storage.task(() => {});
  vm.runInContext(source('checkEmptyUrl') + source('select') + source('field$1'), context);
  for (const registration of bundle.matchAll(/  select\('torrserver_[^']+',[\s\S]*?\);/g)) {
    vm.runInContext(registration[0], context);
  }
  context.Storage = {
    get: context.Storage.get,
    field: context.field$1,
    value: key => localStorage.getItem(key) || ''
  };
  context.Utils$1 = {checkEmptyUrl: context.checkEmptyUrl};
  vm.runInContext(routing + source('ip') + source(torrserverURL), context);
  function set(key, value) {
    localStorage.setItem(key, value);
    delete context.readed[key];
  }
  context.Storage.set = set;
  return {items, writes, notices, context, options, set};
}

const basicAuth = 'Basic ' + Buffer.from('user:pass').toString('base64');
const endpoints = {torrserver_url: 'http://first', torrserver_url_two: 'http://second'};
const credentials = {torrserver_auth: 'true', torrserver_login: 'user', torrserver_password: 'pass'};

test('original settings controls retain their order, labels and remote selectors', () => {
  const line = bundle.split('\n').find(line => line.startsWith('  var ') && line.includes('data-name=\\"torrserver_url\\"'));
  const html = JSON.parse(line.slice(line.indexOf(' = ') + 3, -1));
  const controls = [...html.matchAll(/<div class="settings-param selector" data-type="(select|input)" data-name="(torrserver_[^"]+)"[^>]*>\s*<div class="settings-param__name">([^<]+)<\/div>/g)];
  assert.deepEqual(controls.slice(0, 3).map(match => match.slice(1)), [
    ['select', 'torrserver_use_link', '#{settings_server_link}'],
    ['input', 'torrserver_url', '#{settings_server_link_one}'],
    ['input', 'torrserver_url_two', '#{settings_server_link_two}']
  ]);
  for (const suffix of ['one', 'two']) {
    assert.ok(html.includes('#{settings_server_link_' + suffix + '_descr}'));
  }
  const d = device();
  assert.equal(d.context.Storage.field('torrserver_use_link'), 'one');
  assert.deepEqual({...d.context.values.torrserver_use_link}, {
    one: '#{settings_param_link_use_one}', two: '#{settings_param_link_use_two}'
  });
  assert.equal(d.context.Storage.field('torrserver_url'), '');
  assert.equal(d.context.Storage.field('torrserver_url_two'), '');
  assert.deepEqual(d.writes, [], 'reading defaults must not persist or migrate values');
});

// Missing/invalid selections retain their device-local default behavior.
for (const selection of [undefined, '', 'one', 'two', 'invalid']) {
  for (const one of ['', 'http://first']) {
    for (const two of ['', 'http://second']) {
      const values = {torrserver_url: one, torrserver_url_two: two};
      if (selection !== undefined) values.torrserver_use_link = selection;
      const effective = selection === 'two' ? two || one : one || two;
      const selected = selection === 'two' ? two : one;
      const label = JSON.stringify([selection, one, two]);

      test('endpoint selection and fallback: ' + label, () => {
        const d = device(values);
        assert.equal(d.context.ip(), effective);
        assert.equal(d.context[torrserverURL](), effective);
        assert.deepEqual(d.writes, []);
        assert.deepEqual(d.items, values, 'routing must not swap or rewrite either URL');
      });

      test('parser uses the working endpoint: ' + label, () => {
        const d = device({...values, parser_torrent_type: 'torrserver'});
        const urls = [], failures = [];
        d.context.torrserver = (params, url, done) => {urls.push(url); done({Results: []});};
        d.context.Lang = {translate: key => key};
        d.context.Torserver = {url: d.context[torrserverURL]};
        vm.runInContext(source('get$5'), d.context);
        d.context.get$5({}, () => {}, error => failures.push(error));
        assert.deepEqual(urls, effective ? [effective] : []);
        assert.deepEqual(failures, effective ? [] : ['torrent_parser_set_link: TorrServer']);
      });

      test('authentication covers both configured endpoints: ' + label, () => {
        const d = device({...values, ...credentials});
        const headers = [];
        const xhr = {setRequestHeader: (...args) => headers.push(args)};
        vm.runInContext(source('beforeSend', '        '), d.context);
        for (const endpoint of ['http://first', 'http://second', 'http://unrelated']) {
          d.context.params = {url: endpoint + '/torrents'};
          headers.length = 0;
          d.context.beforeSend(xhr);
          assert.deepEqual(headers, (endpoint === one && one || endpoint === two && two) ? [['Authorization', basicAuth]] : []);
        }
      });

      test('torrent requests and stream URLs follow ip fallback: ' + label, () => {
        const d = device(values);
        const calls = [];
        d.context.clear$e = () => {};
        d.context[torrserverNetwork] = {silent: (url, done, fail, body) => {
          calls.push([url, JSON.parse(body)]); done([{hash: 'hash'}]);
        }};
        d.context.gstWork = () => false;
        vm.runInContext(source('my') + source('stream') + source('toPlayUrl'), d.context);
        let response;
        d.context.my(value => {response = value;}, () => assert.fail('unexpected request failure'));
        assert.deepEqual(calls, [[effective + '/torrents', {action: 'list'}]]);
        assert.equal(response[0].hash, 'hash');
        const stream = effective + '/stream/movie%20name.mkv?link=hash&index=2&';
        assert.equal(d.context.stream('folder/movie name.mkv', 'hash', 2), stream + 'play');
        d.set('torrserver_preload', 'true');
        assert.equal(d.context.stream('folder/movie name.mkv', 'hash', 2), stream + 'preload');
        assert.equal(d.context.toPlayUrl(stream + 'preload'), stream + (effective ? 'play' : 'preload'));
      });
    }
  }
}

for (const selection of ['one', 'two']) {
  for (const protocol of ['http:', 'https:']) {
    for (const url of ['host:8090', 'http://host:8090', 'https://host:8090']) {
      test('URL scheme is preserved: ' + selection + ' ' + protocol + ' ' + url, () => {
        const key = selection === 'two' ? 'torrserver_url_two' : 'torrserver_url';
        const d = device({...endpoints, [key]: url, torrserver_use_link: selection}, {protocol});
        assert.equal(d.context.ip(), url);
        assert.equal(d.context[torrserverURL](), url.includes('://') ? url : protocol + '//' + url);
      });
    }
  }
}

test('authentication toggle and explicit request headers retain their behavior', () => {
  const d = device({...endpoints, ...credentials, torrserver_auth: 'false', torrserver_use_link: 'two'});
  const headers = [];
  d.context.params = {url: 'http://second/torrents', beforeSend: {name: 'X-Custom', value: 'value'}};
  vm.runInContext(source('beforeSend', '        '), d.context);
  d.context.beforeSend({setRequestHeader: (...args) => headers.push(args)});
  assert.deepEqual(headers, [['X-Custom', 'value']]);
});

// Exercise the actual UI hooks with a small jQuery/controller stand-in.
function settingsDevice(values, options) {
  const d = device(values, options);
  const settingsHooks = [], changes = [], queries = [], statusCalls = [], speeds = [];
  let enter;
  const item = {find: () => item, removeClass: () => item, addClass: () => item, after: () => {}};
  d.context.$ = selector => {
    queries.push(selector);
    return selector.startsWith('<') ? {on: (name, callback) => {assert.equal(name, 'hover:enter'); enter = callback;}} : item;
  };
  d.context.Settings = {listener: {follow: (name, callback) => settingsHooks.push(callback)}};
  d.context.Storage.listener = {follow: (name, callback) => changes.push(callback)};
  d.context.Torserver = {ip: d.context.ip, url: d.context[torrserverURL], request: d.context.torrserverRequest, gstExist: () => true};
  d.context.Lang = {translate: key => key};
  d.context.Platform = {is: () => false};
  d.context.start$2 = params => speeds.push({...params});
  d.context.torrent_net = {clear: () => {}, timeout: () => {}, native: (url, done, fail, data, head) => statusCalls.push([url, head])};
  vm.runInContext(source('init$h') + source('init$b') + source('check'), d.context);
  d.context.init$h();
  d.context.init$b();
  const open = () => settingsHooks.forEach(hook => hook({name: 'server', body: {}}));
  const change = (name, value) => {
    if (value !== undefined) d.set(name, value);
    changes.forEach(hook => hook({name, value}));
  };
  return {...d, open, change, enter: () => enter(), queries, statusCalls, speeds};
}

for (const selection of [undefined, 'one', 'two', 'invalid']) {
  for (const one of ['', 'http://first']) {
    for (const two of ['', 'http://second']) {
      test('speed and status use a configured endpoint: ' + JSON.stringify([selection, one, two]), () => {
        const values = {torrserver_url: one, torrserver_url_two: two, ...credentials};
        if (selection !== undefined) values.torrserver_use_link = selection;
        const d = settingsDevice(values);
        const effective = selection === 'two' ? two || one : one || two;
        const status = (selection === undefined || selection === 'one' ? one : two) || effective;
        d.open();
        d.enter();
        assert.deepEqual(d.speeds, effective ? [{url: effective + '/download/300', login: 'user', password: 'pass'}] : []);
        assert.deepEqual(d.statusCalls.map(call => call[0]), status ? [status] : []);
        if (status) assert.equal(d.statusCalls[0][1].headers.Authorization, basicAuth);
        assert.ok(d.queries.includes('[data-name="torrserver_url_two"]'), 'speed button follows the second input');
      });
    }
  }
}

test('status checks follow URL edits and selection changes', () => {
  const d = settingsDevice({...endpoints, torrserver_use_link: 'one', torrserver_auth: 'false'});
  d.open();
  d.change('torrserver_url_two', 'http://edited-second');
  d.change('torrserver_use_link', 'two');
  d.change('torrserver_url', 'http://edited-first');
  d.change('torrserver_use_link', 'one');
  assert.deepEqual(d.statusCalls.map(call => call[0]), [
    'http://first', 'http://edited-second', 'http://edited-second', 'http://edited-first', 'http://edited-first'
  ]);
  assert.ok(d.statusCalls.every(call => !call[1].headers));
  d.change('torrserver_url', '');
  d.change('torrserver_use_link', 'one');
  assert.equal(d.statusCalls.length, 7, 'status checks use the other configured URL when the selected field is empty');
  d.enter();
  assert.deepEqual(d.speeds, [{url: 'http://edited-second/download/300'}]);
});

test('status and speed tests preserve scheme handling for the selected URL', () => {
  const d = settingsDevice({torrserver_url_two: 'second:8090', torrserver_use_link: 'two', torrserver_auth: 'false'}, {protocol: 'https:'});
  d.open(); d.enter();
  assert.equal(d.statusCalls[0][0], 'https://second:8090');
  assert.equal(d.speeds[0].url, 'https://second:8090/download/300');
});

test('search source reacts to both URLs, the selector and parser toggle', () => {
  const d = device({...endpoints, torrserver_use_link: 'two', parse_in_search: 'true'});
  const hooks = [], added = [], removed = [];
  d.context.Storage.listener = {follow: (name, callback) => hooks.push(callback)};
  d.context.network$2 = {clear: () => {}};
  d.context.Platform = {is: () => false};
  d.context.Torserver = {url: d.context[torrserverURL]};
  d.context.Lang = {translate: key => key};
  d.context.Search = {addSource: value => added.push(value), removeSource: value => removed.push(value)};
  vm.runInContext(source('init$x'), d.context);
  d.context.init$x();
  assert.equal(added.length, 1);
  hooks[0]({name: 'torrserver_url_two'});
  hooks[0]({name: 'torrserver_use_link'});
  assert.equal(removed.length, 2);
  assert.equal(added.length, 3);
  d.set('torrserver_url_two', '');
  hooks[0]({name: 'torrserver_url_two'});
  assert.equal(added.length, 4, 'search source registration still uses ip fallback');
  d.set('torrserver_url', '');
  hooks[0]({name: 'torrserver_url'});
  assert.equal(removed.length, 4);
  assert.equal(added.length, 4, 'both empty disables the source');
  d.set('torrserver_url', 'http://restored');
  hooks[0]({name: 'torrserver_url'});
  assert.equal(added.length, 5);
  d.set('parse_in_search', 'false');
  hooks[0]({name: 'parse_in_search'});
  assert.equal(removed.length, 6);
  assert.equal(added.length, 5);
  hooks[0]({name: 'unrelated_setting'});
  assert.equal(removed.length, 6);
});

// Exercise failover through the actual Request implementation: clear() must
// discard a late transport callback before it can retry or change the route.
function routedDevice(values = {}, android = false) {
  const d = device({...endpoints, ...values});
  const requests = [], hooks = [];
  Object.assign(d.context, {
    console: {log() {}, error() {}},
    Subscribe$2: () => ({send() {}}),
    object$2: {cub_mirrors: [], cub_domain: 'cub.test'},
    Mirrors: {connected: () => true},
    Lampa: {Listener: {send() {}}},
    Platform: {is: name => android && name === 'android'},
    Lang: {translate: key => key === 'torrserver_fallback' ? 'Switched to link {link}' : key},
    $: {ajax: params => requests.push(params)},
    Android: {httpReq: (params, callbacks) => requests.push({...params, success: callbacks.complite, error: callbacks.error})}
  });
  d.context.Arrays.extend = (target, extra) => Object.assign(target, extra);
  d.context.Arrays.clone = value => JSON.parse(JSON.stringify(value));
  d.context.Utils$1.clearCard = value => value;
  d.context.Storage.listener = {follow: (name, callback) => hooks.push(callback)};
  vm.runInContext(source('Request'), d.context);
  const start = bundle.indexOf('  var ' + torrserverNetwork + ' = new Request();');
  vm.runInContext(bundle.slice(start, bundle.indexOf('\n  /**', bundle.indexOf('  var Torserver = {'))), d.context);
  return {...d, requests,
    change(name, value) { d.set(name, value); hooks.forEach(callback => callback({name, value})); },
    fail(index, status = 0) { requests[index].error({status}, 'timeout'); }
  };
}

for (const android of [false, true]) {
  test('requests fall back in both directions and retain the working route: android=' + android, () => {
    const d = routedDevice(credentials, android), success = [], failures = [];
    const route = () => d.context.Torserver.request(new d.context.Request(), android ? 'native' : 'silent', '/torrents',
      (json, endpoint) => success.push(endpoint), error => failures.push(error), '{"action":"list"}');
    route();
    assert.equal(d.requests[0].url, 'http://first/torrents');
    d.fail(0, 401);
    assert.equal(failures.length, 0);
    assert.equal(d.requests[1].url, 'http://second/torrents');
    for (const request of d.requests) {
      assert.equal(request.headers.Authorization, basicAuth);
      assert.equal(request.timeout, 5000);
    }
    d.requests[1].success([]);
    assert.deepEqual(d.notices, ['Switched to link 2']);
    assert.equal(d.context.Torserver.ip(), 'http://second');
    assert.ok(d.context.Torserver.stream('movie.mkv', 'hash', 1).startsWith('http://second/stream/'));
    route();
    assert.equal(d.requests[2].url, 'http://second/torrents');
    d.fail(2);
    assert.equal(d.requests[3].url, 'http://first/torrents');
    d.requests[3].success([]);
    assert.equal(d.context.Torserver.ip(), 'http://first');
    assert.deepEqual(d.notices, ['Switched to link 2', 'Switched to link 1']);
    assert.deepEqual(success, ['http://second', 'http://first']);
    assert.equal(failures.length, 0);
    assert.equal(d.items.torrserver_use_link, undefined);
    assert.equal(d.items.torrserver_url, endpoints.torrserver_url);
    assert.equal(d.items.torrserver_url_two, endpoints.torrserver_url_two);
  });
}

test('both links failing reports one error without a false switch notification', () => {
  const d = routedDevice(), failures = [];
  d.context.Torserver.connected(() => assert.fail('unexpected success'), error => failures.push(error));
  d.fail(0); assert.deepEqual(failures, []);
  d.fail(1, 503);
  assert.equal(failures.length, 1);
  assert.equal(d.requests.length, 2);
  assert.deepEqual(d.notices, []);
  assert.equal(d.context.Torserver.ip(), 'http://first');
});

test('an incompatible TorrServer response tries the other link', () => {
  const d = routedDevice(), successes = [];
  d.context.Torserver.connected(json => successes.push(json), () => assert.fail('unexpected failure'));
  d.requests[0].success({});
  assert.equal(d.requests[1].url, 'http://second/settings');
  d.requests[1].success({CacheSize: 128});
  assert.equal(successes.length, 1);
  assert.equal(d.requests[2].url, 'http://second/gst/echo');
  assert.deepEqual(d.notices, ['Switched to link 2']);
});

for (const phase of ['before retry', 'during retry']) {
  test('clear cancels fallback ' + phase, () => {
    const d = routedDevice();
    d.context.Torserver.connected(() => assert.fail('canceled success'), () => assert.fail('canceled failure'));
    if (phase === 'during retry') d.fail(0);
    const count = d.requests.length;
    d.context.Torserver.clear();
    d.fail(count - 1);
    d.requests[count - 1].success({CacheSize: 128});
    assert.equal(d.requests.length, count);
    assert.equal(d.context.Torserver.ip(), 'http://first');
    assert.deepEqual(d.notices, []);
  });
}

for (const key of ['torrserver_url', 'torrserver_url_two', 'torrserver_use_link', 'torrserver_password']) {
  test('settings changed away and back reject delayed fallback: ' + key, () => {
    const d = routedDevice({...credentials, torrserver_use_link: 'one'});
    d.context.Torserver.connected(() => assert.fail('stale success'), () => assert.fail('stale failure'));
    d.fail(0);
    const previous = d.items[key];
    d.change(key, 'temporary'); d.change(key, previous);
    d.requests[1].success({CacheSize: 128});
    assert.equal(d.requests.length, 2);
    assert.equal(d.context.Torserver.ip(), 'http://first');
    assert.deepEqual(d.notices, []);
  });
}

for (const other of ['', 'http://first', 'http://first/']) {
  test('empty or duplicate alternate is not retried: ' + JSON.stringify(other), () => {
    const d = routedDevice({torrserver_url_two: other});
    let failures = 0;
    d.context.Torserver.connected(() => assert.fail('unexpected success'), () => failures++);
    d.fail(0);
    assert.equal(d.requests.length, 1);
    assert.equal(failures, 1);
  });
}

test('fallback add preserves payload and returns its actual endpoint to membership', () => {
  const d = routedDevice(), results = [];
  const object = {link: 'magnet:?xt=urn:btih:hash', title: 'Movie', poster: 'poster'};
  d.context.Torserver.add(object, (json, endpoint) => results.push(endpoint), () => assert.fail('unexpected failure'));
  d.fail(0);
  assert.equal(d.requests[1].data, d.requests[0].data);
  assert.equal(JSON.parse(d.requests[1].data).action, 'add');
  d.requests[1].success({hash: 'a'.repeat(40)});
  assert.deepEqual(results, ['http://second']);
});

test('settings hide a failed-link error when the other link works', () => {
  const d = routedDevice();
  const nodes = new Map();
  d.context.$ = selector => {
    if (!nodes.has(selector)) {
      const node = {find: () => node, removeClass: () => node, addClass: () => node};
      nodes.set(selector, node);
    }
    return nodes.get(selector);
  };
  d.context.$.ajax = params => d.requests.push(params);
  d.context.torrent_net = new d.context.Request();
  vm.runInContext(source('check'), d.context);
  d.context.check('torrserver_url');
  d.fail(0);
  assert.deepEqual(d.notices, []);
  d.requests[1].success('TorrServer');
  assert.deepEqual(d.notices, ['Switched to link 2']);
  // Checking the broken inactive URL again must not repeat the switch toast.
  d.context.check('torrserver_url'); d.fail(2); d.requests[3].success('TorrServer');
  assert.deepEqual(d.notices, ['Switched to link 2']);
  d.context.check('torrserver_url'); d.fail(4); d.fail(5);
  assert.equal(d.notices.length, 2, 'both unavailable still reports an error');
});

test('shared auth does not leak to similar or unrelated URLs', () => {
  const d = device({...endpoints, ...credentials});
  const headers = [];
  vm.runInContext(source('beforeSend', '        '), d.context);
  for (const url of ['http://first.evil/torrents', 'http://second-backup/torrents', 'http://elsewhere/?next=http://first']) {
    d.context.params = {url};
    d.context.beforeSend({setRequestHeader: (...args) => headers.push(args)});
  }
  assert.deepEqual(headers, []);
});

for (const android of [false, true]) test('search retries preserve /ts compatibility, query, timeout and credentials: android=' + android, () => {
  const d = routedDevice({...credentials, torrserver_url: 'https://first/path/ts/',
    torrserver_url_two: 'https://second/root/ts', parse_timeout: '20', torrserver_search_type: 'rutor'}, android);
  vm.runInContext(source('buildUrl$1') + source('torrserver'), d.context);
  d.context.Utils$1.buildUrl = d.context.buildUrl$1;
  d.context.network$2 = new d.context.Request();
  const results = [];
  d.context.torrserver({search: 'Movie & title'}, d.context.Torserver.url(), json => results.push(json), () => assert.fail('search failed'));
  assert.equal(d.requests[0].url, 'https://first/path/search/?query=Movie%20%26%20title');
  d.requests[0].success({invalid: true});
  assert.equal(d.requests[1].url, 'https://second/root/search/?query=Movie%20%26%20title');
  assert.equal(d.requests[1].timeout, 20000);
  assert.equal(d.requests[1].headers.Authorization, basicAuth);
  assert.equal(d.requests[1].svtlv_search, undefined);
  assert.equal(d.requests[1].svtlv_validate, undefined);
  d.requests[1].success([]);
  assert.equal(results.length, 1);
  assert.deepEqual(d.notices, ['Switched to link 2']);
});

test('late GStreamer discovery from a previous route cannot enable it on the fallback', () => {
  const d = routedDevice();
  d.context.Torserver.gstCheck();
  d.context.Torserver.my(() => {}, () => assert.fail('unexpected failure'));
  d.fail(1); d.requests[2].success([{hash: 'a'.repeat(40)}]);
  assert.equal(d.context.Torserver.ip(), 'http://second');
  d.requests[0].success('echo');
  assert.equal(d.context.Torserver.gstExist(), false);
  d.context.Torserver.gstCheck();
  d.requests[3].success('echo');
  assert.equal(d.context.Torserver.gstExist(), true);
});
