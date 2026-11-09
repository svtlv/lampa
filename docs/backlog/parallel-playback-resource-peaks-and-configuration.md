---
worth: yes
where: devops/measure-playback.sh:1
added: 2026-11-06
---
# Verify parallel playback capacity and the remaining incident cause

Repository implementation is complete. Live migration, incident attribution and
capacity remain unverified. This follow-up does not hold the
[completed implementation plan](../plans/completed/20261108-parallel-playback-and-container-migration.md)
open and is not a request to run production trials during implementation.

## Evidence retained

On November 7, 2026 at 19:11:06 UTC, a host-global OOM killed TorrServer with
approximately 7.3 GiB anonymous resident memory and exhausted swap. It restarted
under its existing policy. This identifies the victim, not a leak, initiating
request or proof that parallel playback alone caused the event. Later quiet
metrics/new cgroup generations do not erase the historical kill. Neighboring
service deadlines coincided with pressure; independent outages/data loss were
not established. Historical details remain in commit `2162282`.

The November 8 inventory recorded MatriX.143, per-hash 2 GiB RAM caches, 1%
preload, 95% read-ahead, 25 connections and a 30-second disconnect timeout.
Same-hash readers share cache; distinct hashes multiply the nominal budget.
Neither nominal cache nor cgroup memory is process RSS. The selected MatriX.150
source supports the documented tuning fields and full-object settings save;
these source findings do not benchmark the newer runtime.

The reported "Not saved to Account" warning appeared on a signed-in client
while another client was anonymous. Offline characterization showed a failed
background GET could produce it without a PUT. Cross-device notification
delivery, the actual failed operation/status and resource-pressure causation
were not established. Commit `0ac7703` retains the owner clarification and
prior investigation; adjacent socket observations are not proven causes and
are outside this follow-up unless new evidence connects them.

## Repository work already delivered

- Account error classification, bounded page-local diagnostics and independent
  client regressions: `dadd0cd`. Misleading unchanged-read wording is corrected;
  the actual production warning remains untraced.
- Two-link membership union with active-list intersection and both-ID membership
  removal: `6972aea`. Account/guest isolation and local link/player choice remain.
- Local playback cancellation, terminal cleanup and stale-response fences,
  preserving explicit public drop and paused heartbeats: `9ec81a8`.
- Pinned vendor Compose definitions, non-streaming healthchecks, full-stack
  readiness, manual migration/rollback instructions and bounded fixture-tested
  measurement tooling. No settings candidate or new resource limit was applied.

These deliverables close the implementation objectives. The deleted message
classification and cross-link backlog items must not be recreated for completed
work. No unit test is proof of a live incident fix or measured capacity.

## Outstanding owner-operated acceptance

Use the [cutover runbook](../container-migration-runbook.md) and
[measurement and acceptance procedure](../parallel-playback-validation.md).
Their full-settings apply/readback/rollback procedure, workload matrix and stop
gates are authoritative. Keep raw logs, rollback snapshots, credentials, media
identifiers and private host details outside Git.

1. Complete the manual old-writer shutdown/consistent backup/exact-bind cutover
   and verify saved data, credentials, consumers and later normal redeployment.
   Retain `/opt/svtlvtv/jackett/config`; do not overlap old/new writers.
2. During an owner-chosen bounded window, establish a safe idle/single-viewer
   reference and numeric headroom/pressure/latency thresholds. Do not replay the
   unsafe three-distinct-torrent 2 GiB profile merely to obtain a baseline.
3. Test cache-only 512 MiB first, then 4% preload separately, preserving the
   complete settings object and all other values. Record actual version-specific
   settings, full readback, functional checks and rollback for each stage.
4. Measure one/two/three distinct 1080p streams, same-hash readers and unrestricted
   single-viewer 4K. Include three repeated startup/seek/cancel cases, LAN/tailnet,
   concurrent Jackett searches, pause/resume and one viewer stopping while others
   continue. Sustain required parallel playback for 60 minutes and observe cleanup
   for 10 minutes after all readers/pollers stop. Three-4K trials are optional.
5. Correlate host/container generations, CPU, memory, swap/reclaim, PSI, I/O and
   neighboring-service health with buffering and absolute startup/seek latency.
   Capture reader/heap evidence separately if needed: the collector supplies
   neither. Avoid status/cache probes that extend idle expiry.
6. Recheck the anonymous/signed-in warning arrangement, then same-account,
   different-account and guest pairs. Correlate local
   `window.svtlv_sync_diagnostics()` phase/method/status/category/timing with
   backend health and host pressure. Record app/plugin versions; verify accurate
   errors, retained dirty edits, membership isolation and local link/player choice.
7. Identify demonstrated bottlenecks versus hypotheses and publish sanitized
   baseline/candidate results, limitations, keep/revert decisions and supported
   capacity. Any durable resource boundary needs a measured cache/overhead budget
   and repeated acceptance; a cgroup OOM remains failed playback.

Close/delete this follow-up only after its outstanding incident/capacity work is
resolved with recorded live evidence. No live trial, production change, deployment
or successful migration is claimed by the completed repository implementation.
