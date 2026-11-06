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
