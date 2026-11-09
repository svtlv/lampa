# Parallel playback measurement and acceptance

The repository provides a read-only collector for later playback and search
trials. No production collection, deployment, playback acceptance or capacity
measurement has been performed. Fixture results demonstrate the collector, not
server capacity. The candidates and procedure below are ready for later owner-run
trials; their performance and supported capacity remain unverified. Initial
container adoption preserves the complete live settings without applying them.

## Run the collector later

Run on the Linux Docker host using Bash and Python 3.8 or newer. No Python
packages are required. The Docker CLI must target that same host and the reader
must have permission to inspect its containers and read their `/proc` and cgroup
files. A remote Docker context, Docker Desktop VM, containerized collector or
restricted PID/cgroup namespace does not provide a matching host view. Use the
host's local Docker context; do not interpret mismatched host/container counters.
The collector never changes permissions or installs dependencies.

From a checkout containing both companion files:

```sh
umask 077
bash devops/measure-playback.sh --duration 4200 --interval 5 \
  --annotations /tmp/playback-events.jsonl > /tmp/playback-run.jsonl
```

Create the annotations file before starting, or omit `--annotations` when no
annotations are needed. Its absence is reported, not treated as an empty file.
Output goes to standard output, so choose a private destination outside Git.
Keep the terminal/consumer draining output; a blocked pipe or unresponsive
filesystem can delay exit like any local command.

The default targets are `torrserver`, `jackett`, `svtlvtv_lampa_api`,
`svtlvtv_lampa_web` and `svtlvtv_lampa_db`. For a local Compose project or neighbor
comparison, replace the complete target list using repeated `--container`:

```sh
bash devops/measure-playback.sh --duration 120 --interval 5 \
  --container ts=torrserver --container search=jackett \
  --container api=svtlvtv_lampa_api > /tmp/playback-short.jsonl
```

The left side is a public output alias; the right side is the actual container
name and is never exported. Use neutral aliases without private names. Selecting
custom targets replaces all defaults. At most 16 unique aliases and names are
accepted. Add neighboring containers explicitly to correlate their resource and
health state with the host totals; the default list does not discover neighbors.

`--duration` accepts 0.1–86400 seconds (default 60); `--interval` accepts 0.1–60
seconds (default 5). Scheduling uses a monotonic clock. Samples start immediately,
then follow the interval, skipping missed ticks instead of catching up in a burst.
One filtered Docker inspection per sample has a two-second timeout, shortened to
the remaining run duration. There is no unbounded Docker retry. The deadline
bounds collection scheduling and external-command waits; process startup, local
reads and final output add small overhead. Slow inspection may reduce sample count.
SIGINT/SIGTERM end collection with a summary; an in-flight inspection can take up
to two seconds to finish. An interrupted process can leave an incomplete last line.

Exit status 0 means the bounded run ended, including runs with unavailable
metrics. Status 2 means invalid options; status 1 means a fatal collector/output
error. Check `unavailable` and coverage before using a run for comparisons. A
missing summary means the result is incomplete. The collector does not decide
whether playback or capacity passed.

## Playback annotations

The annotations file must be a regular file and contains one JSON object per newline. Append events while
collecting, using seconds since collector start; a future offset is emitted once
that offset is reached. Final due events are included before the summary. Records
are emitted once per distinct complete line. Exact duplicates are suppressed.
Keep a new file per run; replacing it does not retract events already emitted.

```jsonl
{"offset_seconds":0,"event":"start","client":"v1","bitrate_mbps":12.5,"viewers":1,"platform":"android","player":"external","route":"lan","workload":"single_1080p"}
{"offset_seconds":60,"event":"seek","client":"v1","bitrate_mbps":12.5,"viewers":1}
{"offset_seconds":120,"event":"stop","client":"v1","viewers":0}
```

Only these fields are accepted. Extra fields reject the entire record. No free
text, titles, hashes, URLs, credentials, user/device names or file paths belong
in the annotations.

| Field | Accepted values |
| --- | --- |
| `offset_seconds` | Required finite JSON number, 0 through requested duration |
| `event` | Required: `start`, `preload`, `seek`, `pause`, `resume`, `stop`, `search`, `buffering`, `recovered` |
| `client` | Required neutral viewer alias `v1` through `v16` |
| `bitrate_mbps` | Optional finite number, 0–10000; megabits per second, not bytes |
| `viewers` | Optional integer 0–16 |
| `platform` | Optional: `android`, `tizen`, `webos`, `browser`, `apple`, `other` |
| `player` | Optional: `builtin`, `external`, `other` |
| `route` | Optional: `lan`, `tailnet`, `other` |
| `workload` | Optional: `idle`, `single_1080p`, `distinct_1080p`, `same_hash`, `single_4k`, `mixed`, `search` |

The file is reread each tick, permitting live appends. It is bounded to 1 MiB and
4096 bytes per line. An unfinished last line waits for its newline. Unreadable,
oversized or invalid records produce fixed diagnostic labels, never raw content.
The collector does not measure media bitrate or infer active viewers; annotations
are operator-supplied context. `search` records correlate naturally occurring or
separately operated searches without the collector issuing any search itself.

## JSONL result contract (schema version 1)

Each output line has `schema_version`, `type`, UTC ISO `timestamp` and monotonic
`elapsed_seconds`. The timestamp describes emission; `collection_seconds` records the sample read
span. Metric reads within a sample are sequential. Rates use elapsed time between their actual reads, not the nominal
interval. Records are:

| Type | Content |
| --- | --- |
| `metadata` | Requested duration/interval, public container aliases, Linux/cgroup-v2 support and host `page_size_bytes` |
| `sample` | `host`, `containers` keyed by alias, and sorted `unavailable` labels |
| `annotation` | Validated event fields plus common record fields |
| `summary` | Sample count, stop `reason` (`duration` or `signal`) and union of unavailable labels |

Missing or malformed metrics have `null` values and an unavailable label.
Unsupported optional counter fields are omitted; a missing host VM counter,
cgroup CPU usage counter or OOM-kill counter is also named explicitly. First
rates are `null`. A decreasing counter resets that field's rate to `null`; a
missing read resets its rate baseline. An observed container disappearance,
restart, replacement, cgroup path change or cgroup inode change increments its
public integer `generation` and clears its rate baselines. Generations are local
to this run, not globally stable identifiers. Brief between-sample transitions
may be unobserved. A PID's cgroup association is rechecked after reads; a changed
association discards the container metrics for that sample.

| Group | Metrics and interpretation |
| --- | --- |
| `host.cpu` | `/proc/stat` tick counters; `busy_percent` is host-wide 0–100, treating idle and I/O-wait as not busy; guest ticks are not counted twice |
| `host.memory` | Selected `/proc/meminfo` fields converted from KiB to bytes; `used_bytes = MemTotal - MemAvailable`; `sampled_peak_used_bytes` is the highest observed host usage during this run, not a kernel peak or process RSS |
| `host.vm_counters`, `vm_per_second` | Host OOM kills, swap-in/out, major faults, direct/background scan and steal; cumulative since boot and rates; swap counters are pages, converted using metadata page size when needed |
| `host.pressure` | CPU, memory and I/O PSI, `some`/`full` where present: `avg10`, `avg60`, `avg300` percentages and cumulative `total` stall microseconds; host CPU `full` is not a useful host saturation metric |
| `host.disk` | Per major:minor device read/write byte counters and bytes/second from `/proc/diskstats`; sectors converted using 512 bytes; stacked devices/partitions can double-count, so do not sum blindly |
| `host.network` | Per-interface byte counters/rates with neutral `ifN` aliases; no names/IPs; includes loopback/virtual interfaces, so do not sum blindly |
| `containers.<alias>` | Inspect availability, status, configured health status, Docker restart count and last `oom_killed` state; no health output or logs |
| `metrics.cpu_*` | cgroup CPU time in microseconds, throttling counters/rates; `cpu_percent` uses 100 per fully used logical CPU and can exceed 100 |
| `metrics.memory_*` | Current and kernel peak bytes, selected memory.stat values and page-fault/reclaim rates, cumulative memory.events and their rates (including OOMs); these include cache/kernel charges and are not process RSS |
| `metrics.swap_*` | cgroup current and kernel peak swap bytes, if the kernel exposes them |
| `metrics.pressure` | Per-cgroup CPU/memory/I/O PSI using the same units as host PSI |
| `metrics.io_*` | Summed cgroup rbytes/wbytes/rios/wios counters and rates; stacked storage may duplicate accounting |
| `metrics.network_*` | Summed non-loopback bytes/rates from the container PID's network namespace; shared namespaces share counters and must not be summed as independent traffic |

Kernel memory/swap peaks and OOM counters predate collection and span the current
cgroup's lifetime; the collector never resets them. Attribute new events using
counter differences within a generation. A stopped/restarting container retains
Docker health/OOM/restart evidence but has unavailable live metrics. A missing
container yields `available:false`; other containers and host metrics continue.
Cgroup v1, inaccessible cgroups, and a PID mapped to the host cgroup root yield
explicitly unavailable container metrics. There is no approximate v1 fallback.
Older kernels may lack peak, swap or PSI files. No zero is substituted for them.

For comparison, keep the metadata, complete samples, summary and annotations
together. Align elapsed intervals with workload events. Compare the same workload,
route, target aliases and sampling interval. Split comparisons at generation
changes, missing metrics and counter resets. An unhealthy neighbor or host swap
pressure remains significant even when TorrServer's own counters look quiet.
Absence of a sampled peak or OOM event is not proof that none occurred between
samples. The tool neither inspects private settings nor records candidate values;
keep nonsecret trial values alongside results in the later acceptance record.

### Example fixture output

This is a shortened synthetic result, not a production observation. Full samples
contain all groups described above. In this example, a missing kernel peak file
is visible rather than reported as zero:

```jsonl
{"schema_version":1,"type":"metadata","timestamp":"2026-11-09T00:00:00+00:00","elapsed_seconds":0,"duration_seconds":1.2,"interval_seconds":0.4,"containers":["ts"],"platform":"linux","cgroup_support":"v2","page_size_bytes":4096}
{"schema_version":1,"type":"sample","timestamp":"2026-11-09T00:00:00.400000+00:00","elapsed_seconds":0.4,"host":{"memory":{"used_bytes":12288000,"sampled_peak_used_bytes":12288000}},"containers":{"ts":{"available":true,"status":"running","health":"healthy","oom_killed":false,"restarts":0,"generation":1,"metrics":{"memory_current_bytes":1048576,"memory_peak_bytes":null,"cpu_percent":0}}},"unavailable":["containers.ts.memory_peak"]}
{"schema_version":1,"type":"summary","timestamp":"2026-11-09T00:00:01.200000+00:00","elapsed_seconds":1.2,"samples":3,"reason":"duration","unavailable":["containers.ts.memory_peak"]}
```

Run the synthetic checks locally (no Docker daemon or Linux host needed):

```sh
bash -n devops/measure-playback.sh
node --test tests/playback-measurement.test.cjs
```

The tests supply temporary proc/cgroup files and a fake Docker executable. They
check CPU/memory/pressure/I/O/network parsing, rate/reset math, time bounds,
restart/cgroup generations, missing counters, command failures, redaction,
annotation appends and signal termination. Fixture-root switches exist only for
these tests; normal operation uses `/proc` and `/sys/fs/cgroup`.

## Candidate sequence and source contract

The recorded MatriX.143 settings are historical inputs. Before any later trial,
read the actual full settings from the deployed MatriX.150 target and preserve
them privately. If versions or settings differ, reassess the comparison rather
than silently overwriting them with the snapshot. The following source checks
were made against the selected MatriX.150 tag on November 9, 2026.

| API field | Unit / meaning | Recorded value | Staged trial |
| --- | --- | --- | --- |
| `CacheSize` | Bytes per distinct torrent cache; UI conversion uses binary MiB | `2147483648` (2 GiB) | A: `536870912` (512 MiB), all other fields retained |
| `PreloadCache` | Percent of cache used to calculate nominal preload | `1` | Retain `1` for A; B changes only this to `4` after A is evaluated |
| `ReaderReadAHead` | Percent of each active reader's share ahead of its position | `95` | Retain; optional later trial `80` moves capacity behind the reader |
| `ConnectionsLimit` | Established peer connections per torrent; also affects piece-loading concurrency per reader | `25` | Retain; optional later trial `16` may reduce work and throughput |
| `UseDisk` / `ResponsiveMode` | Disk cache / responsive reader booleans | `false` / `true` | Retain; no disk conversion |
| `TorrentDisconnectTimeout` | Seconds used to extend torrent expiry | `30` | Retain; measure cleanup rather than shortening blindly |
| `DownloadRateLimit` / `UploadRateLimit` | Positive values are multiplied by 1024 for byte/s limits; `0` is unlimited | `0` / `0` | Retain |
| `DisableUpload` / `RemoveCacheOnDrop` | Upload disablement / disk-cache deletion booleans | `false` / preserve actual value | Retain; disk deletion is not a RAM budget |
| `TrackTimecode` | Shared server playback-position recording | `false` | Retain; preserve local Timeline behavior |
| `StoreSettingsInJson` / `StoreViewedInJson` | Settings / viewed storage preferences | `true` / `false` | Retain with all unlisted settings |

The tagged [settings model and validation](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/settings/btsets.go)
define these fields. They clamp read-ahead to 5–100% and preload to 0–100%; zero
cache/connection/timeout values select fallback defaults, not an unlimited cache
or disabled expiry. The [settings UI](https://github.com/YouROK/TorrServer/blob/MatriX.150/web/src/components/Settings/SettingsDialog.jsx)
converts cache input using 1024 squared despite its MB label.
The [BT client setup](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/btserver.go)
maps peer/rate fields to the client. These facts support candidate syntax and
units, not a prediction that lower values will play smoothly.

The [storage implementation](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/storage/torrstor/storage.go)
creates a cache per hash; readers of that hash share it. The
[reader range calculation](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/storage/torrstor/reader.go)
divides cache capacity among active readers and splits ahead/behind space using
`ReaderReadAHead`. Changing 95 to 80 redistributes space; it does not shrink the
cache. Readers at different offsets may need different pieces even for one hash.

| Distinct hashes | Recorded 2 GiB per hash | Candidate 512 MiB per hash |
| --- | --- | --- |
| 1 (including two/three readers sharing it) | 2 GiB | 0.5 GiB |
| 2 | 4 GiB | 1 GiB |
| 3 | 6 GiB | 1.5 GiB |

These are nominal payload budgets, not process RSS or hard cgroup ceilings.
Piece buffers/rounding, readers, networking and Go heap retention add overhead.
The [cache implementation](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/storage/torrstor/cache.go)
uses capacity for piece eviction, with protected reader/file ranges; allocation
can exceed the nominal number. A smaller cache reduces seek and forward cushion.

The [preload calculation](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/apihelper.go)
uses `CacheSize * PreloadCache / 100`. The recorded 2 GiB at 1% yields about
20.48 MiB. Trial A (512 MiB at 1%) yields about 5.12 MiB. Trial B (512 MiB at 4%)
restores about 20.48 MiB nominal preload. Actual work also depends on pieces and
beginning/end reads in the [preloader](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/preload.go).
Compare A with the safe reference, then B with A. Do not combine optional
read-ahead/peer changes with either trial. Larger preload may improve the initial
cushion while increasing startup work; neither outcome is measured yet.

Keep existing client preload behavior for the first comparison. Record each
player, codec and any GStreamer/transcoding path. A later direct-streaming trial
requires native decoding support on that client; do not disable a needed path.
Keep both URLs, shared credentials, useful account sync and local player/link
selection. No setting is invented for the built-in polling cadence.

## Full-settings apply, readback and rollback

This is a later manual operation, separate from the read-only collector. It must
run in an idle maintenance window with no viewers or preloads on the affected
server. A settings save is disruptive even when only one field changes.

The target [API handler](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/web/api/settings.go)
uses `POST /settings` with JSON `action` equal to `get`, `set` or `def`. A `get`
request (`{"action":"get"}`) returns the settings object directly. A `set` request
requires that complete object under `sets`; it does not merge a sparse patch.
Missing fields become Go zero values before validation. Never use `def` for a
trial or rollback.

The target [save implementation](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/apihelper.go)
stores settings, drops all active torrents, disconnects the BT client and retries
reconnection up to 30 times, with one-second waits after failed attempts. The
handler also restarts DLNA/Bonjour/rutor helpers as applicable. No container
restart is required for this normal API path. HTTP 200 alone proves neither
durability nor a connected torrent client: read-only mode skips the save, and
reconnect failure is logged without changing the handler's success status.

1. Identify the actual server/version behind the chosen URL. Two URLs may reach
   one server; save once per physical instance. Coordinate all users, stop
   viewers/preloads and prevent concurrent settings edits. Use existing
   authentication privately, with bounded requests and no credentials in URLs,
   command history or shared output. Retain the migration backup separately.
2. Read the full object through `POST /settings` with `action=get`. Preserve a
   private, access-restricted byte-for-byte response plus a parsed rollback copy,
   target version, time and nonsecret trial identifier outside Git. Abort on a
   failed/invalid response. Include nested Torznab/TMDB credentials and all
   unrelated fields in the private copy; do not export them in a trial report.
3. Copy that full object and change only A's `CacheSize`, or only B's
   `PreloadCache` from A's verified full object. Compare recursively against the
   snapshot; the intended single field must be the only change. Re-read before
   writing and stop/rebase the candidate if settings changed. There is no atomic
   compare-and-swap here; coordination remains necessary. Keep a full rollback
   snapshot for each stage as well as the original pre-trial snapshot.
4. Submit `action=set` with the entire merged object in `sets`, using JSON
   content type. Do not send this document's table as a partial object. Allow for
   reconnect delay. After timeout/disconnection, read current settings and
   establish state before retrying: a failed response does not prove no write.
5. Read the full object again with `action=get` and compare every field with the
   intended result, including unchanged nested values and storage preferences.
   Treat unexpected differences, read-only behavior or failed reads as a failed
   application. Check service readiness and then deliberate playback/search
   functionality; version-only liveness does not establish BT reconnection or
   saved-settings durability. Recheck retention at the later normal redeployment.
6. On pressure/regression, stop the trial workload first. During the resulting
   idle window, restore the complete chosen rollback object through the same
   `set` path and repeat full readback and functional checks. Preserve current
   state and reconcile unrelated edits before rollback so they are not silently
   lost. If recovery fails, keep trials stopped and use the runbook's manual
   recovery procedure. Do not edit files assuming hot reload or downgrade the
   binary against upgraded data.

Settings exports may contain secrets. No API request is supplied as an automated
helper, and none is executed during repository validation. The procedure does not
authorize a production change as part of implementation.

## Workload matrix for later acceptance

Start with a safe idle and single-viewer reference on the deployed version.
Do not reproduce the unsafe three-hash, 2 GiB-per-hash profile merely to obtain a
baseline. After applying a candidate in an idle window, progress from one to two
to three viewers only while the stop gates below remain clear. Keep content,
bitrate, codec, player, route, indexer set and neighboring load comparable.

| Workload | Required observations |
| --- | --- |
| Idle before/after | Host/neighbor load, TorrServer current memory and pressure, retained heap versus live cache; no torrent polling for expiry measurement |
| One 1080p viewer | Startup/preload, steady throughput, buffering and seek recovery; establishes a safe latency reference |
| Two then three distinct 1080p torrents | Simultaneous preload, sustained playback and seeks; distinct-hash memory growth and aggregate bitrate |
| Two then three readers of one hash | Different offsets, pause/resume and seeking; close/cancel one viewer, stop one, verify others continue |
| Discovery and dialog lifecycle | Discovery success, error and 90-second timeout; close during discovery/preload, repeated open/replacement, late callbacks; no automatic hash-wide drop |
| All viewers stopped | Stop external players and close dialogs/pollers on every client; observe at least 10 minutes without status/cache probes that extend lifetime |
| LAN and tailnet | Repeat startup/seek and multi-viewer cases on each used route; record bitrate and route rather than assuming equal bandwidth |
| One 4K viewer | Actual codec/player support, bitrate, startup, seek, buffering and resource headroom; selection stays unrestricted |
| Jackett search and search during playback | Fixed indexer set, one then concurrent client searches, latency/retries/fan-out and impact on playback/neighbors |
| My Torrents | Both configured URLs, shared and different servers, active-list intersection, absent hashes, duplicate URLs, account/guest isolation, partial removal failure/retry, local link/player choice |
| Account warning | Reported anonymous/signed-in pair during simultaneous playback; then same-account, different-account and guest pairs; accurate read/apply/save errors and recoverable dirty edits |

Repeat startup/seek/cancellation cases three times for each candidate. Sustain
the required three-viewer 1080p workload for at least 60 minutes, then collect at
least 10 minutes after all readers and pollers stop. Use the documented
`--duration 4200 --interval 5` collector run for that 60+10-minute segment; run
setup, reference and repeated short cases separately, or increase the duration
within its 86400-second maximum. Do not let setup consume the required sustain
or cleanup coverage. Include same-hash and distinct-hash cases in the record.

4K has no resolution restriction, forced downgrade or blanket bandwidth cap.
Single-viewer 4K is required later acceptance; mixed or three-4K workloads are
optional exploration and no three-4K capacity is promised. Resolution alone does
not specify bitrate, network quality or decoder requirements.

For account-warning reproduction, record the signed-in client's local
`svtlv_sync_diagnostics()` phase/method/status/category/timing, backend health and
host pressure alongside the workload. Record actual app/plugin versions. No
tokens, identities, document bodies or setting values belong in the report.
Similar messages on two clients do not establish cross-device delivery. The
reported production cause remains unreproduced by repository tests.

Local cancellation stops this client's requests/timers; it does not promise
immediate server-side preload termination. The target's
[expiry implementation](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/torrent.go)
requires zero cache readers, an elapsed deadline and working/closed state;
reader close extends the deadline. Background preload and deadline-refreshing
requests can delay expiry. Saved torrent records may remain after live cache
expires, and Go may retain freed heap. The collector has no reader counter or
heap profiler: quiet memory alone cannot prove reader cleanup or a leak. Record
coverage limits and investigate unexpected retention separately, without keeping
the torrent alive by measuring it.

## Separate Jackett search trials

Compare idle Jackett with one search and then simultaneous searches from two and
three clients, first without streaming and then during the accepted streaming
workload. Preserve the same enabled indexers, keys, cookies, cache settings and
Torznab route. Record warm/cold cache conditions rather than clearing production
cache to force a result. Use neutral query/scenario aliases; retain any private
query/indexer detail outside Git.

Append `search` annotations and keep start/completion latency, failures, retries,
result counts and indexer fan-out in the companion trial record. Fan-out here
means the number of configured indexers actually queried, not just the number
of Lampa clients. The collector measures host/container overhead and health; it
does not issue searches or infer search latency/fan-out. Compare Jackett CPU,
memory, network and pressure alongside TorrServer, API and selected neighbors.

Do not remove indexers, rotate keys, disable useful account sync, add an unsupported
concurrency option or introduce a proxy/helper/extra server for this comparison.
If search fan-out is the bottleneck, record it as follow-up with supported
options researched for the deployed version; do not disguise it as steady-stream
capacity or promote an untested Jackett default.

## Stop gates, success and resource decisions

Before increasing load, use the safe reference to write numeric minimum available
memory/headroom, swap/reclaim rate, PSI duration/percentage, CPU saturation and
neighbor latency/health thresholds in the private trial record. These host-specific
numbers are not known yet. An unset threshold or unavailable required metric
means capacity acceptance is incomplete; it does not block repository completion.
Check changes in OOM/restart counters within each collector generation rather
than treating historical peaks/events as new failures.

| Gate | Decision |
| --- | --- |
| New OOM, unexpected restart, cross-viewer interruption or neighbor failure | Stop workload immediately; preserve evidence, then roll back settings in an idle window |
| Numeric headroom/pressure/swap/latency threshold crossed, severe sustained reclaim or growing buffering | Stop escalation and revert the candidate if it caused regression; do not wait for an OOM |
| Startup/seek latency | Record absolute seconds and worst of three matched repetitions; proposed gate is no more than 20% worse than the safe one-viewer reference for comparable content/player/route |
| Required playback quality | No new sustained/repeated buffering or cross-viewer drops; all lifecycle, ownership and account-error cases pass |
| Duration and coverage | Required 60-minute three-viewer sustain and 10-minute cleanup recorded; missing observations remain unverified |
| Planned full-stack deployment | Test separately for retained data/credentials/readiness; expected playback interruption is outside capacity trials |

Lower memory use alone is insufficient. Compare sampled current/peak charged
memory for idle, one/two/three hashes and same-hash readers, plus startup/seek
bursts. Budget for allocator/piece/network/reader overhead from those observed
envelopes; do not subtract a nominal full cache from a partially filled sample
and call the remainder an exact overhead measurement. Cgroup memory includes
cache/kernel charges and is not process RSS. If process RSS/heap attribution is
needed, collect it separately with private diagnostics; the shipped collector
does not provide it.

Reserve host memory for measured neighbors, OS and observed bursts; check
`MemAvailable`, swap/reclaim, PSI and service health together. Swap already in use
is different from sustained swap traffic; neither a quiet TorrServer cgroup nor
an OOM victim alone identifies the initiating process. Do not sum overlapping
network/storage accounting or compare kernel lifetime peaks across generations
as if they were run-local maxima.

Only after these measurements should a separate reviewed change choose memory,
swap, CPU or PID boundaries. Verify the proposed fields are supported by the
actual standalone Compose/Engine versions and read back their effective runtime
limits after a later deployment; do not assume Swarm-only settings constrain
standalone Compose. Repeat playback acceptance under any chosen boundaries.
A cgroup OOM is a failed stream, not successful host protection. No new cap,
`GOMEMLIMIT`, aggressive GC setting, disk-cache conversion or rate restriction
is applied by this implementation. Existing `GODEBUG=madvdontneed=1` is preserved.

## Trial record and promotion

Keep complete JSONL metadata/samples/annotations/summary and private rollback
exports outside Git. Use public trial aliases for any sanitized findings added
here. The collector accepts only the documented event fields; store codec,
absolute startup/seek latency, buffering duration/count, search latency/fan-out,
numeric thresholds and nonsecret settings values in a separate record. A
`recovered` event alone does not distinguish first frame from seek recovery.

| Record | Required content / current status |
| --- | --- |
| Version and comparison | Image/runtime/app/plugin versions, safe reference ID, candidate stage and changed nonsecret values; no live run yet |
| Coverage | Workload, distinct hashes versus readers, route, player/platform/codec, bitrate and duration; not yet measured |
| Resource outcome | Host/neighbor envelope, current/peak memory with generations, CPU, swap/reclaim, PSI, I/O/network, OOM/restarts, unavailable metrics; not yet measured |
| Playback/search outcome | Absolute and relative startup/seek latency, buffering, searches/retries/fan-out, account/membership/lifecycle cases; not yet verified |
| Decision | Stop thresholds, failures, full readback, keep/revert decision and rollback verification; no candidate promoted |

Promote A or B only after the applicable matrix and gates pass with adequate
headroom; otherwise retain/revert the safe settings and record the failure.
Document supported capacity only for the measured content, clients, routes and
neighbor conditions. Initial cutover, later normal redeployment, actual incident
reproduction and initiating-process attribution remain separate operational
results. Unmeasured capacity or unresolved incidents must stay visible as
follow-up; automated checks cannot establish a live fix.

## Collector read-only boundaries and references

Only metric/configured-state reads and output to standard output occur. The
collector never runs `docker exec`, Compose, health probes, container logs,
application APIs, streams, torrent/cache/status requests, settings writes,
restarts, cleanup or load generation. Python runs with bytecode writing disabled.
Inspection discards stderr, exports only whitelisted state and never exports
container IDs, environments, cgroup paths or probe output. Metric file errors and
invalid annotations use fixed labels. Public target aliases are user-selected;
keep private names out of them and keep raw operational records outside Git.

Linux semantics follow the primary [cgroup v2 interface reference](https://docs.kernel.org/admin-guide/cgroup-v2.html),
[PSI reference](https://docs.kernel.org/accounting/psi.html), and
[proc filesystem reference](https://docs.kernel.org/filesystems/proc.html).
Docker filtering uses the documented [inspect format option](https://docs.docker.com/reference/cli/docker/inspect/).
Service definitions and takeover context remain in
[the inventory](container-migration-inventory.md) and
[the migration runbook](container-migration-runbook.md).
