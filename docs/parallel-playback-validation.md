# Parallel playback measurement

The repository provides a read-only collector for later playback and search
trials. No production collection, deployment, playback acceptance or capacity
measurement has been performed. Fixture results demonstrate the collector, not
server capacity. Tuning candidates and the acceptance procedure are a separate
implementation task.

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

## Read-only boundaries and references

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
