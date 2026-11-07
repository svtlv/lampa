---
worth: yes
where: "Lampa/TorrServer parallel playback and deployment configuration"
added: 2026-11-06
---
# Investigate parallel playback peaks and recommend TorrServer/Lampa settings

## Context and objective

The owner reports starting to use Lampa on two devices in parallel and associates
that workload with the recent host-load peaks. Prior read-only measurements
found short, severe load/run-queue bursts coinciding with nearly exhausted RAM,
full swap, heavy memory reclaim and CPU/I/O pressure; long-period CPU execution
was much lower than those load numbers suggest. TorrServer was a substantial
memory consumer in contemporaneous snapshots, but historical per-process
attribution and a controlled one-device versus two-device comparison are not
yet established. Treat the parallel-use explanation as the owner's report and
an investigation hypothesis, not a completed root-cause finding.

Determine how to reduce CPU/load peaks and memory/reclaim pressure while keeping
two simultaneous playback sessions responsive. Deliver concrete, measured,
version-appropriate configuration recommendations for **both TorrServer and
Lampa**, with trade-offs and rollback, rather than merely recommending more CPU.

## Measurement and reproduction

- Record deployed TorrServer/Lampa versions, relevant add-ons, effective
  non-secret settings and available host/container resource budgets. Map each
  proposed setting to the exact option supported by those versions; do not
  invent setting names, defaults or universally safe cache sizes.
- Compare idle, one-device and two-device operation with matched content and
  network conditions. Include the same torrent versus different torrents,
  simultaneous startup/preload, steady playback, seeking, stopping one client
  while the other continues, and sustained playback long enough to observe
  cache growth and cleanup. Where relevant compare LAN and tailnet access,
  including two configured URLs reaching the same physical server. Do not
  conflate that with the separate cross-link ownership feature.
- Correlate per-container/process CPU, RSS/cache, available host RAM, swap
  traffic, page faults/reclaim and CPU/memory/I/O PSI with network/disk activity,
  peer/request counts, Lampa polling/sync traffic and playback events. Preserve
  peak-period coverage with bounded, low-overhead recording; averages and a
  snapshot taken after recovery cannot establish the cause.
- Separate client-side work, TorrServer streaming/cache/reclaim work, API/sync
  work and unrelated host workloads. Check for duplicated torrent sessions or
  redundant work, leaked polling/listeners, and cache retained after playback.
  Investigate shared-cache behavior rather than assuming it is per-device or
  recommending separate server instances without evidence.

## Configuration candidates to evaluate

Evaluate only settings actually supported by the installed versions:

- **TorrServer:** total/per-torrent cache and buffering/read-ahead behavior,
  memory versus disk-backed caching where available, concurrent torrents and
  streams, peer/connection limits, inactive torrent/cache cleanup, and any
  applicable runtime/container resource controls. Determine whether limits are
  aggregate or multiply by active torrents/clients. Reserve headroom for the
  OS and neighboring services; a hard memory cap without a cache budget and
  cleanup strategy may just cause OOM kills or interrupt playback.
- **Lampa:** preload/buffer behavior exposed by the active player/integration,
  unnecessary torrent/status polling or duplicate requests, hidden/background
  client activity, sync cadence/debouncing and lifecycle cleanup. Preserve
  independent playback and device-local link selection; do not disable useful
  account synchronization merely to mask a resource problem.
- Record baseline and candidate values, how each is applied durably, expected
  quality/latency trade-offs and how it is reverted. Treat host swap changes,
  forced restarts, broad rate limits or extra TorrServer instances as separate
  proposals requiring evidence, not default fixes.

## Acceptance and deliverables

- Produce a repeatable baseline/candidate comparison for two-device startup,
  steady playback, seek and stop/restart cases, including peak and sustained
  CPU/RAM/pressure, startup/seek latency and buffering interruptions. Record
  coverage, test duration, repetitions and content/network differences.
- Identify the demonstrated bottleneck and distinguish confirmed causes from
  remaining hypotheses. Agree measurable success thresholds before candidate
  trials; show whether the proposed settings reduce peaks and memory/reclaim
  stalls while both streams remain usable and unrelated services keep
  sufficient headroom. Report negative results rather than asserting success.
- Publish recommended TorrServer and Lampa profiles with exact supported
  settings/values, applicable versions, capacity assumptions, measured benefits,
  drawbacks, durable configuration locations and a rollback procedure. If one
  profile cannot safely serve the tested combinations, document its limits.
- Add automated regression checks for any code/lifecycle defect discovered and
  validate on the actual two-device browser/TV setup. Keep the separate
  [device-message isolation bug](isolate-messages-between-parallel-devices.md)
  tracked independently, even if a shared cause is later established.

Investigation/backlog only. Do not stress-test the production host, change live
TorrServer/Lampa settings, restart services, impose resource limits or deploy as
part of filing this item. Arrange a safe test environment or an explicitly
approved bounded test window for disruptive experiments.

## Investigation findings — November 6, 2026

**Status: source/runtime investigation completed to available evidence; controlled playback A/B and initiating-process attribution remain pending. No fix or settings change applied.**

**Version/evidence:** Lampa `43693da786a1333e5550a3e790332c920668717d` frontend/add-ons match deployed revision `be26ded19991468b312d87b9593d84cb8c88f0ba`. Live TorrServer identifies as MatriX.143; implementation traced at official `YouROK/TorrServer@5c812ec1abe4c8e0acee29d820f78205a8f0e7b7`, including its actual replacement dependency `tsynik/torrent v1.2.28` (`server/go.mod:5-7`). Runtime read-only settings retrieval confirms CacheSize=2147483648 bytes, PreloadCache=1%, ReaderReadAHead=95%, ConnectionsLimit=25, RAM cache and ResponsiveMode=true. No settings save, stream probe or restart was performed.

**Findings:**

- CacheSize is **per distinct torrent infohash**, not a global server limit (`server/torr/btserver.go:96-97`; `server/torr/storage/torrstor/storage.go:20-39`). Same-hash readers share a cache and divide its active retention window (`torrstor/reader.go:143-160`). Two different torrents currently have nominal 4 GiB combined budget. Piece buffers allocate lazily at full piece size; accounting tracks written bytes and eviction is asynchronous/range-protected, so CacheSize is **not a hard RSS ceiling** (`torrstor/mempiece.go:20-33`; `cache.go:234-306`).
- ReaderReadAHead=95 means **95% of each active reader's cache share ahead, 5% behind**, not 95 MiB. Separate immediate dependency readahead is fixed at 16 MiB (`server/torr/torrent.go:211-227`). PreloadCache=1 gives approximately 20.48 MiB nominal startup target (`apihelper.go:290-300`), with beginning/end piece effects. RemoveCacheOnDrop controls disk-file deletion; RAM ownership is cleared regardless (`cache.go:140-170`), so changing it with UseDisk=false is not the RAM fix.
- Lampa preloading polls status approximately every second, starts at reported fill ≥95% (or NaN), and cancels after 30 seconds without increasing bytes (`app.min.js:41339-41403`). Playback info polls every 2 seconds while visible, approximately **12 seconds** while hidden, and requests cache state after status (`:14111-14155`, `:8333-8338`). Status/cache lookups refresh torrent expiry and can reload saved torrents (`server/web/api/stream.go:131-148`; `api/cache.go:47-59`; `apihelper.go:88-117`). A shorter timeout can cause churn instead of fixing retention. File-dialog close and discovery timeout issue **hash-wide drops**, potentially interrupting another device on the same torrent (`app.min.js:41233-41253,41690-41705`). These are static mechanisms, not reproduced peak attribution.
- Historical host evidence is severe memory/swap/reclaim pressure, not sustained four-hour CPU saturation; TorrServer's approximately 7 GiB historical footprint is relevant but initiating process remains unknown. At 20:02 UTC it was idle, approximately 877.5 MB cgroup current memory. Its 7953358848-byte memory peak is lifetime since October 26, not incident-dated. All 25 listed records were stat=5 (**TorrentInDB**, `server/torr/state/state.go:24-30`; `dbwrapper.go:72-87`), not 25 active caches. Zero cgroup OOM events does not exclude host-global OOM.

**Concrete candidate for a scheduled, approved trial:** CacheSize=`536870912` bytes (**512 MiB**, UI 512), PreloadCache=`4`%, ReaderReadAHead=`95`, ConnectionsLimit=`25`, UseDisk=`false`, RemoveCacheOnDrop=`false`, ResponsiveMode=`true`, TorrentDisconnectTimeout=`30`, DownloadRateLimit=`0`, UploadRateLimit=`0`, DisableUpload=`false`; preserve all other fields. This cuts nominal cache fourfold while preserving approximately 20.48 MiB nominal preload. Two distinct torrents then have nominal 1 GiB combined cache, not a process cap. Smaller cache sacrifices forward/seek cushion and must be checked on high-bitrate/variable-swarm playback. For single-variable isolation, test CacheSize=536870912 alone first, explicitly noting PreloadCache=1 then targets only 5.12 MiB; test 4% separately afterward. Optional later trials: ReaderReadAHead=80 (redistributes, does not shrink capacity), or ConnectionsLimit=16 (less peer/piece concurrency, possible throughput loss). No profile is proven optimal; no blind disk-cache, rate-limit or CPU/memory-cap recommendation.

**Lampa candidate and code boundaries:** keep `torrserver_preload=true` for the initial trial; its startup path is the one traced above. Prefer `torrserver_gts=false` (direct streaming) only if both devices can decode the media natively and do not require the optional GST path; GST capability is checked separately (`app.min.js:8468-8482,49393-49398`). Actual per-device preferences/players were not inspected, so this is a conditional recommendation, not evidence GST caused the peaks. Preserve the two URL definitions and each device's local `torrserver_use_link`; compare a reachable LAN route versus the tailnet route rather than assuming either is the bottleneck. The 2-second/12-second status loop is hard-coded, not an exposed tuning setting. Reducing unwanted polling/retention and replacing hash-wide cancellation with viewer-aware cleanup require a separately tested code change; do not invent a settings switch or disable account sync to achieve it. In particular, verify that one device closing the file dialog cannot drop another device's live same-hash stream before calling parallel use safe.

**Application is disruptive:** official UI/API settings save uses a complete settings object, persists it, drops **all torrents**, disconnects/reconnects the BT client, and restarts relevant helpers (`server/web/api/settings.go:45-60`; `server/torr/apihelper.go:238-252`). It does not require a container restart. Never submit these candidate fields as a sparse replacement, and never save during playback. Direct file edits are not established as hot-reloaded. Cache API unit is bytes; UI's MB label uses binary MiB (`web/src/components/Settings/SettingsDialog.jsx:56-70`).

**Remaining acceptance:** no measured one-device/two-device A/B was available, and the tiny offline scalar model is not a playback benchmark. During a future approved window compare one device, two distinct torrents, then two same-hash readers with identical media/seek patterns; collect anonymous active counts/readers, CPU, RSS/cgroup memory, PSI, swap/reclaim, startup, rebuffer and seek recovery. Do not use deadline-refreshing status/cache calls to validate idle expiration. Stop on pressure/regression; rollback the preserved full settings during an idle window. Attribute the initiating process and verify disconnect/reader cleanup and cross-device drop/reload before closing this item.

## Critical recurrence: confirmed global OOM — November 7, 2026

**New evidence materially escalates this existing item:** at **19:11:06 UTC**,
the kernel recorded a host-wide (`global_oom`, unconstrained) out-of-memory
kill of TorrServer, whose anonymous resident memory was approximately
**7.3 GiB**. Swap was exhausted. This is confirmed historical OOM victim
attribution, stronger than the November 6 pressure-only observations. It does
**not** establish a memory leak, the initiating allocation/request, or that
parallel playback alone caused the event.

TorrServer restarted at **19:11:11 UTC** under its existing restart policy;
no investigator restart or repair was performed. Incident diagnostics found
no explicit container memory limit. Current post-restart `OOMKilled=false` or
zero counters in its new cgroup generation do not erase the historical kernel
kill. The cumulative restart counter is not the number of kills in this one
episode.

Monitoring also observed Distributor and Immich ML deadlines during the
pressure episode. Shared resource contention is a plausible contributor;
independent database/Kafka outages, missed application work and data loss were
not established. By approximately 19:18 UTC independent health observations
had recovered and the collector closed incident-176. Endpoint recovery is not
a demonstration of uninterrupted playback or recurrence prevention.

After restarting, TorrServer again showed substantial multi-GiB memory
excursions, including subsequent decreases; do not call the growth monotonic
or a proven leak. A fresh **read-only settings query at 20:23 UTC** still
returned CacheSize=2147483648 bytes, PreloadCache=1, ReaderReadAHead=95,
ConnectionsLimit=25, UseDisk=false, ResponsiveMode=true and
TorrentDisconnectTimeout=30. Thus the earlier 512 MiB/4% candidate has **not**
been applied or validated. Same-image/source cache-scope and lifecycle findings
above remain relevant; the precise active torrents/readers at the kill are
unknown and must not be reconstructed from later saved-entry counts.

### Required priority work and acceptance

- Treat prevention as a critical availability/host-headroom requirement, not
  merely a noisy health-check or CPU-only optimization. Preserve anonymous
  kernel/cgroup-generation evidence in private incident records; do not publish
  raw logs, media identifiers, credentials or infrastructure access details.
- Attribute the working set across cache payloads, allocated-vs-accounted
  pieces, readers/in-flight writes, Go heap/GC and other services. Correlate
  resource pressure with actual concurrent playback and cancellation, rather
  than equating the OOM victim with proof of a particular application defect.
- Validate the memory-first candidate and aggregate concurrent-torrent budget
  in an approved bounded playback window. Measure peak/sustained memory,
  host headroom, swap/reclaim/PSI, CPU, startup/seek latency and buffering for
  one viewer, two distinct torrents and two same-hash viewers. Nominal cache
  capacity is not a hard RSS cap; account for lazy allocations and overhead.
- Assess reader/session-aware cancellation, post-playback cleanup and any
  aggregate memory/admission/backpressure controls needed. Evaluate a container
  memory boundary only with a measured cache/overhead budget and interruption
  trade-offs; moving failure into a cgroup OOM is not a complete playback fix.
- Acceptance must demonstrate no OOM or severe reclaim collapse in the tested
  sustained parallel workload, bounded cleanup after viewers stop, sufficient
  neighboring-service headroom and no cross-viewer interruption. Record test
  coverage and rollback; do not close the item solely because `/echo` or
  dependent health checks recover.

No production settings, resource limits, service restarts or deployments were
performed while adding this evidence. Supported settings save remains
interrupting for all torrents and requires its own planned/authorized window.
