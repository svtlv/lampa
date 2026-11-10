# Implement parallel-playback fixes and TorrServer/Jackett Compose configuration

> **Historical implementation record.** Repository work was completed November 9,
> 2026. Deployment, configuration/data verification and old-path cleanup completed
> November 10, 2026; operational evidence is retained in the administration workspace.
> The migration inventory, migration runbook and open-ended incident/capacity backlog
> were subsequently retired at the owner's request; their original content remains
> in Git history. The dated decisions and handover instructions below are historical,
> not current operating instructions or a scheduled acceptance backlog.
> Use [README Operations](../../../README.md#operations) for maintained guidance.
> The collector's basic usage remains in README. No playback-capacity result or
> incident-cause resolution follows from retiring these documents.

Tasks 1–12 passed applicable repository checks. Earlier validation notes preserve
historical checkpoints; their then-pending later implementation tasks are complete.

## Objective and completion contract

Deliver the repository changes for all three backlog items, add the existing
TorrServer and Jackett services to this repository's Compose stack, and prepare
resource-measurement tooling and tuning documentation.

**This plan is self-contained and completes before release or deployment.** Every
implementation task can be completed using this checkout, the findings recorded
below and local automated checks. No task requires the owner to answer a question,
provide production credentials, release, deploy, stop a container, change a live
setting, run playback or collect measurements. No additional Hermes investigation
or access to private server documentation is an implementation prerequisite.

The deliverable is code, configuration, tests and documentation ready for the
owner to deploy. All owner-operated actions appear exclusively in the final
**Post-implementation handover** section. That section is not an implementation
phase or a dependency of implementation completion.

## Fixed scope and decisions

- Use the latest stable TorrServer and Jackett container releases for the move,
  preserving ports, credentials and existing data. Use release tags plus verified
  digests, not the old deployed images or prerelease/nightly/master builds. Add
  definitions using the same three binds; do not copy, relocate or regenerate data.
- Keep the normal full-stack pull/down/up deployment lifecycle. Once managed by
  this stack, TorrServer and Jackett redeploy on every deployment, even when their
  configuration is unchanged. Deployments may interrupt playback.
- Keep initial takeover of the old Compose project manual. Implement no old-project
  shutdown, takeover, data migration, rollback or `/opt` cleanup automation.
- Preserve both TorrServer URLs, their shared credentials, local active-link
  selection, account isolation and the existing removal of shared server timecodes.
- Implement account-error classification, cross-link torrent membership and safe
  built-in playback cancellation using the established findings below.
- Prepare the bounded measurement collector and supported tuning candidates now.
  Preserve existing live settings in the initial service definitions. Actual
  measurements, candidate application and promotion are post-implementation work.
- Target three simultaneous 1080p streams and single-viewer 4K in later acceptance.
  Keep 4K selectable with no resolution restriction or forced downgrade. Three
  simultaneous 4K streams are optional, not a promised capability.
- At implementation completion, delete resolved backlog files. Keep genuinely
  unresolved incident/capacity follow-up visible without making it a dependency
  of finishing or archiving this plan.

| Historical backlog file | Repository work and final disposition |
| --- | --- |
| `docs/backlog/isolate-messages-between-parallel-devices.md` | Task 6 (`dadd0cd`): accurate account errors, bounded diagnostics and independent-client regressions. Deleted as resolved implementation work; live warning attribution remains in the follow-up below. |
| `docs/backlog/share-torrents-between-torrserver-links.md` | Task 7 (`6972aea`): cross-link membership union and safe removal with account/guest/race coverage. Deleted as resolved. |
| `docs/backlog/parallel-playback-resource-peaks-and-configuration.md` | Tasks 2–5 and 8–10: service definitions, safe cancellation/cleanup, collector and documented tuning candidates delivered. Retained only for outstanding live incident/capacity acceptance. |

## Findings available to the implementer

These facts are sufficient implementation inputs. Production observations were
obtained read-only through the configured Hermes peer on November 8, 2026,
09:49–09:55:51 UTC. They are a dated snapshot, not proof of later deployment or
playback capacity. Reconcile bundle names and local edits against the checkout;
Rollup suffixes and line numbers are not stable APIs.

### Existing deployment contract

| Item | Recorded value |
| --- | --- |
| Old Compose project | `torrserver` |
| Old live definition | `/opt/svtlvtv/torrserver/docker-compose.yml` |
| Old service/container names | `torrserver`, `jackett` |
| Destination project | `svtlvtv` |
| Destination live definition | `/home/deploy/svtlvtv/docker-compose.yaml` |
| Repository definition | `devops/docker-compose.yaml` |
| TorrServer | MatriX.143, `linux/amd64` |
| Jackett | Image `v0.24.2475-ls9`, application `v0.24.2475`, runtime `9.0.19`, `linux/amd64` |
| Restart policy | `unless-stopped` for both |
| Published ports | TorrServer `8090/tcp`, Jackett `9117/tcp`, existing IPv4/IPv6 host interfaces; no published UDP |
| Existing networks | `torrserver_default` and `svtlv_monitoring_external` |
| Destination networks | Destination default network plus existing `svtlv_monitoring_external`, preserving service aliases |

These are the historical installed images, retained as rollback references only;
they are not the target images for the new service definitions:

```text
ghcr.io/yourok/torrserver@sha256:9a6b95f5744af2fcff55c505891c737f22dd6e1d3d53269fc2268ef3382507d9
lscr.io/linuxserver/jackett@sha256:341ace61a953dd404892abd319ac6c871e39189c8e0a9cf618d03666a7620fa1
```

### Latest stable target releases

Rechecked November 9, 2026 against the official GitHub latest-release APIs
(`draft=false`, `prerelease=false`) and registry manifests:

| Service | Latest stable target | Published |
| --- | --- | --- |
| TorrServer | `MatriX.150` | November 6, 2026 |
| Jackett application (separate from the selected image) | `v0.24.3036` | November 9, 2026 |
| LinuxServer Jackett image | `v0.24.3030-ls30` | November 8, 2026 |

The latest published stable LinuxServer image still contains Jackett v0.24.3030;
its moving `latest` index matches the release pin below. The newer application
release does not yet have a newer published LinuxServer image release. Keep the
verified container pin and effective no-update behavior. Public verification and
target-source compatibility notes are recorded in
`docs/container-migration-inventory.md`.

Use these release-tagged, multi-platform image-index pins; both include
`linux/amd64` for production and `linux/arm64`:

```text
ghcr.io/yourok/torrserver:MatriX.150@sha256:2d02152b804946848f032dcca94fa0f096c8840cff3d37e1ba5400c30f70e16b
lscr.io/linuxserver/jackett:v0.24.3030-ls30@sha256:3af37ff2ca5f14da5529b9e2018e384735daf1bf08b99350e1211be863eeae20
```

At implementation start, check public release/registry metadata for a newer stable
release and refresh the target tags/digests if necessary. This is an implementer
action requiring no owner input or production access. Record the selected versions
and assess compatibility using their matching source/release notes. Do not use a
moving development tag or assume old-version behavior proves new-version behavior.

MatriX.150 source inspection confirms the container path variables/`TS_DONTKILL`
flag, cache-size byte units, preload/read-ahead percentage units, no-reader expiry
condition and settings-save entry point still exist. The old MatriX.143 resource
observations remain baseline evidence, not a benchmark of the upgraded version.
Retain complete existing configuration instead of replacing it with new defaults.

### Existing persistent data and runtime settings

| Host bind source | Container destination | Ownership / content |
| --- | --- | --- |
| `/var/lib/torrserver/config` | `/opt/ts/config` | `0:0`, directory `0755`; `settings.json`, BBolt `config.db`, search state `rutor.ls` |
| `/var/lib/torrserver/cache` | `/opt/ts/torrents` | `0:0`, directory `0755`; empty at observation, RAM cache enabled |
| `/opt/svtlvtv/jackett/config` | `/config` | `1000:1000`, directory `0755`; complete server/indexer configuration, credentials, cookies and DataProtection state |

These are all recorded mounts; there are no named/anonymous volumes. Jackett has
24 indexer JSON files and 20 `.bak` files; those backups are not a verified full
backup. Its directory under `/opt` remains a required live bind source.

TorrServer's effective command is:

```text
torrserver --path /opt/ts/config --logpath /opt/ts/log --port 8090 --torrentsdir /opt/ts/torrents --dontkill
```

Environment includes `TS_DONTKILL=1` and `GODEBUG=madvdontneed=1`; the process runs
as `0:0`. HTTP-auth enabling environment, `accs.db` and `trackers.txt` were absent.
Preserve that contract and any stored client credentials; introduce no new auth
requirement. Logs are in the writable layer at `/opt/ts/log`.

Jackett runs `/app/Jackett/jackett --NoUpdates` as `1000:1000`, with a root s6
supervisor. `AUTO_UPDATE` is absent and no application writable-layer changes were
observed. Preserve effective `--NoUpdates` behavior even though persisted
`UpdateDisabled=false`. Environment includes `PUID=1000`, `PGID=1000`,
`TZ=Asia/Jerusalem`, `XDG_DATA_HOME=/config`, `XDG_CONFIG_HOME=/config`,
`TMPDIR=/run/jackett-temp`. Persisted settings include `Port=9117`,
`LocalBindAddress=127.0.0.1`, `AllowExternal=true`, `AllowCORS=false`,
`CacheEnabled=true`, `CacheTtl=2100`, `CacheMaxResultsPerIndexer=1000`.
Blackhole/base-path/base-URL overrides are null. Adopt the complete existing
configuration rather than rebuilding it from these nonsecret examples.

TorrServer uses `jackett:9117/api/v2.0/indexers/all/results/torznab/`; its configured
API key matches Jackett's. Preserve that DNS alias, route and stored key. No
FlareSolverr/VPN container or configured Jackett proxy/FlareSolverr endpoint was
found; add none. Preserve the monitoring network and existing client endpoints.

Neither service currently has explicit CPU/memory/swap/PID limits or Docker
healthchecks. Both use `json-file` logging without explicit container rotation.
The source repository/redeployer of the old definition, additional external
consumers, a verified full backup and details of residual writable-layer files
were not established. These unknowns do not block implementing the definitions;
the repository must not invent replacement data or require their discovery.

### Established application findings

- The reported warning was **"Not saved to Account"** on a signed-in device while
  another device was anonymous. `svtlv/account-sync.js` uses the save-error path
  for background GET failures and apply errors as well as actual save failures.
  Offline characterization reproduced the misleading toast without a PUT. There
  is no established cross-device message delivery or proven production cause.
- `svtlv/torrserver-ownership.js` currently scopes membership to the effective URL.
  The requested behavior is the union of the current user's ownership under both
  configured URLs, intersected with the active endpoint's live list. The existing
  API already supports endpoint-scoped membership without contacting TorrServer.
- Built-in file-dialog close and file-discovery timeout call
  `Torserver.drop(SERVER.hash)`, a hash-wide cancellation that can affect another
  viewer. Discovery timeout also needs terminal timer/request cleanup. Remove
  these automatic destructive calls while keeping explicit public `drop` working.
- MatriX.143 expires cached torrents when there are no readers and their expiry
  deadline has passed. Status/cache requests can extend that deadline. This
  supports local cancellation without hash-wide drops; actual deployed cleanup
  remains a later acceptance check, not an implementation prerequisite.
- `--dontkill` controls process signals, not torrent idle expiry. The audited
  baseline and MatriX.150 sources ignore SIGTERM with this flag. The supported
  `/shutdown` API closes the
  torrent client and database before exit. These semantics inform the handover;
  implementation must not call that API or alter an old container.

### Resource findings and candidate basis

The host snapshot showed an Intel N150 with four logical CPUs, 15.365 GiB RAM,
3.752 GiB available and approximately 4 GiB swap with 3.489 GiB used. Neighbors
include three approximately 1 GiB Kafka brokers, Aspire, Immich, databases and
Keycloak. Ethernet negotiated 1 Gbit/s; available WAN/tailnet capacity was not
measured.

A confirmed November 7 global OOM killed TorrServer at approximately 7.3 GiB
anonymous resident memory with swap exhausted. That establishes the victim, not
a leak or the initiating request. The deployed settings still used
`CacheSize=2147483648`, `PreloadCache=1`, `ReaderReadAHead=95`,
`ConnectionsLimit=25`, `UseDisk=false`, `ResponsiveMode=true`,
`TorrentDisconnectTimeout=30`, unlimited download/upload and `DisableUpload=false`.
`TrackTimecode=false`, `StoreSettingsInJson=true`, `StoreViewedInJson=false`.

CacheSize is per distinct torrent hash, not a global process limit. Three distinct
torrents currently imply 6 GiB nominal cache; a 512 MiB candidate implies 1.5 GiB,
plus unmeasured piece/reader/network/heap overhead. Same-hash readers share cache.
A 4% preload with a 512 MiB cache gives approximately 20.48 MiB nominal preload.
These source-supported candidates are untested; do not represent them as proven
production settings or silently apply them during migration.

## Repository constraints and implementation design

- Frontend distribution files are edited directly; there is no frontend build
  system. All shipped JavaScript remains ES5-compatible.
- Account and ownership changes stay in `svtlv/` and use public `window.Lampa`
  APIs. Built-in cancellation changes are narrowly marked edits in `app.min.js`.
  Do not change compiled CSS or locale dictionaries for these add-ons.
- Preserve boot fallback, account-generation/baseline/revision guards, dirty local
  edits, encryption policy, shared credentials, local player/link selection and
  Timeline behavior. Add-on messages use inline English/Russian strings.
- Ownership uses the existing normalization and SHA-256 IDs. Union the two
  configured IDs without physical-server discovery or backend schema changes.
  Claim under the endpoint used for the operation. Removal releases only this
  user's membership under both IDs, never the server torrent. Partial failure
  must not report success; retries are idempotent.
- Capture both endpoint IDs plus account/selection/operation generations. Invalidate
  pending ownership work after either URL changes, account switching, logout or
  away-and-back selection changes. Preserve equivalent browser-local guest logic.
- Classify account errors by caller intent and phase. An unchanged client's failed
  background read must not claim an unsaved edit; a failed read required to save
  dirty edits can still mean the save failed. Keep retries and failure suppression.
- Existing Apache remains an API-only proxy; add no media/search proxy. Keep web
  `8092:80`, project/volume identity, environment selection and monitoring access.
- Deploy selected stable third-party image pins through the Compose workflow, not new
  build-matrix images. Preserve image-before-build and build-block stripping
  layout. Update `.env.example` and generated deployment env together only if new
  variables are actually needed; service definitions require no new credentials.
- Operational artifacts belong under existing `devops/`, `docs/` and `tests/`,
  already excluded from the public web image. Do not add a public data directory.

## Implementation checks and completion

Each task delivers repository changes and passes applicable automated checks
before dependent tasks. Use fixture data and mocked HTTP/timers/clients; no
production host, owner input, device playback or live credentials are needed.
Documentation tasks need link/path/snippet checks, not artificial unit tests.

Run the Node runtime suite, pinned ES5 syntax gate, Compose rendering with the
example env and shell syntax checks. The measurement collector is tested with
fixtures, not live measurements. Backend code is not expected to change; any
necessary backend change also needs matching Go tests and the existing supported
Linux/CI lint/test/race checks. Do not hide skipped or unavailable checks.

Completion means all repository deliverables and applicable automated checks are
finished, resolved backlog files are removed, and the final handover is complete.
Archive this plan at that point. Deployment and live acceptance are explicitly
unperformed and cannot block completion or be claimed as passed.

## Implementation steps

### Task 1: Publish the recorded service and data contract

**Files:**
- Create: `docs/container-migration-inventory.md`
- Modify: this plan only if implementation reveals a repository-level correction

- [x] Record old baseline images separately from the selected latest-stable
  targets. Refresh targets from public release/registry metadata if needed, then
  record commands, ports, UID/GID, networks and binds. No production access is needed.
- [x] Document preservation of full existing configuration and the internal
  Torznab connection without copying credentials or private data into Git.
- [x] Identify the existing Jackett bind under `/opt` as persistent data rather
  than obsolete deployment source.
- [x] Document known unknowns as post-implementation context, not prerequisites
  or requests for the owner to act during implementation.
- [x] Validate documented values against this plan and repository path conventions.

Task 1 validation (November 9, 2026): all four historical/target image references,
three bind pairs, runtime/network values, local document links and public-image
exclusion checked. Official release APIs and raw registry-index SHA-256 checks
confirm the selected container pins; matching tagged runtime sources inspected.
`node --test tests/*.test.cjs` passed 520 tests with no skips;
`npx --yes acorn@8.14.0 --ecma5 --silent svtlv/*.js app.min.js` and
`docker compose -f devops/docker-compose.yaml --env-file devops/.env.example config --quiet`
passed. No executable shell snippets/scripts or backend code changed; shell and
Go checks are not applicable. Production access and live acceptance were not
performed.

### Task 2: Add the TorrServer Compose service

**Files:**
- Modify: `devops/docker-compose.yaml`, `devops/.env.example` if needed
- Modify: `.github/workflows/deploy-docker.yaml` only for necessary env wiring

- [x] Define `torrserver` with the selected latest-stable release/digest, compatible
  command/environment, existing root ownership, restart policy and `8090/tcp`
  host bindings. Check target-version config/CLI compatibility from public source.
- [x] Mount `/var/lib/torrserver/config:/opt/ts/config` and
  `/var/lib/torrserver/cache:/opt/ts/torrents`; preserve current settings in place.
- [x] Join destination default and monitoring networks with alias `torrserver`.
  Preserve current peer exposure, auth and signal behavior; add no migration job.
- [x] Define image-supported liveness that touches no torrent/cache/stream and
  does not require introducing credentials or production access during development.
- [x] Validate rendered Compose and env fixtures, including missing/invalid inputs
  and compatibility with the existing release transformation.

Task 2 validation (November 9, 2026): official latest-release API and raw
registry-index SHA-256 still confirm MatriX.150 and the recorded digest. Tagged
Dockerfile, entrypoint, settings and signal-handler sources retain the recorded
runtime contract. The tagged [HTTP router and echo handler](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/web/server.go)
provide a version-only `GET /echo` without torrent/cache access; the Alpine image
supplies BusyBox `wget`. The healthcheck uses that endpoint with a bounded timeout.
No new environment variables, credentials or deployment-env wiring were needed.

Added 14 daemon-free Compose fixture tests and wired them into the existing CI
Compose job. They cover runtime/data/network preservation, liveness, Test and
Production/default environments, missing/empty required values, invalid port and
secret inputs, and the actual release image/build transformation. The release
shell passed `bash -n` and executed against temporary fixtures (BSD sed's empty
backup suffix is supplied locally on macOS). `node --test tests/*.test.cjs` passed
534 tests with no skips; the pinned ES5 gate and example-env Compose rendering
also passed. Backend code did not change, so Go checks are not applicable.
No containers were started and no production access, deployment, settings writes
or live acceptance were performed.

### Task 3: Add the Jackett Compose service

**Files:**
- Modify: `devops/docker-compose.yaml`, `devops/.env.example` if needed
- Modify: `.github/workflows/deploy-docker.yaml` only for necessary env wiring

- [x] Define `jackett` with the selected latest-stable release/digest, effective
  in-container no-update behavior,
  UID/GID/TZ/environment, restart policy and `9117/tcp` host bindings.
- [x] Mount `/opt/svtlvtv/jackett/config:/config` directly; do not regenerate
  ServerConfig, indexers, cookies, DataProtection state or API/admin credentials.
- [x] Preserve alias `jackett` on the default and monitoring networks and the
  TorrServer Torznab route. Add no FlareSolverr/VPN or unused downloads mount.
- [x] Define supported liveness/readiness and document expected failures without
  requiring a running production container or revealing private configuration.
- [x] Validate Compose/env fixtures and the declared image, mount, identity,
  environment, port and network contracts with applicable local checks.

Task 3 validation (November 9, 2026): the official LinuxServer latest-release
API and raw registry-index SHA-256 still confirm v0.24.3030-ls30 and the selected
pin, including linux/amd64 and linux/arm64. Matching tagged image/launcher sources
preserve the root s6 supervisor, PUID/PGID, configuration paths and effective
`--NoUpdates` with `AUTO_UPDATE` absent. The matching application's anonymous
`GET /health` returns a constant status without indexer searches or credentials;
the base image supplies curl. Added its bounded healthcheck and documented failure
modes and the distinction between HTTP readiness and working indexer/Torznab access.

Four new daemon-free fixture tests cover Jackett's runtime/data/network and
healthcheck contracts and invalid ports. Existing environment and actual release
transformation tests now also verify Jackett's unchanged pin/service definition.
`node --test tests/*.test.cjs` passed 538 tests with no skips; the pinned ES5 gate,
example-env Compose rendering, release-transformation tests, all 12 deployment
shell blocks (`bash -n`), inventory local links and `git diff --check` passed.
No new environment variables or deployment-workflow changes were needed. Backend
code did not change, so Go checks are not applicable. No containers were started;
production access, deployment, settings writes and live acceptance were not
performed. Task 4 retains responsibility for the release readiness wait.

### Task 4: Include both services in every normal full-stack deployment

**Files:**
- Modify: `.github/workflows/deploy-docker.yaml`
- Modify: `.github/workflows/tests.yaml` only for changed automated checks

- [x] Retain full-stack pull/down/up so TorrServer and Jackett redeploy with
  Lampa even when unchanged. Preserve project/volume identity and manual trigger.
- [x] Keep vendor pins intact through release image rewriting/build-block removal;
  preserve environment handling, monitoring network and existing API health wait.
- [x] Implement needed TorrServer/Jackett readiness and failed-startup reporting;
  keep the release path simple, without release-time Compose grep guards.
- [x] Add no old-project takeover, data copying, settings rewrite or `/opt`
  deletion logic. Preserve existing mounts and normal data-volume retention.
- [x] Validate workflow shell syntax, rendered release Compose and relevant
  automated checks without dispatching a workflow or deploying anything.

Task 4 validation (November 9, 2026): the deployment retains the manual/default-
branch/environment gates, web/API-only build matrix, project/volume identity,
monitoring network and full-stack pull/down/up sequence. Release rendering still
preserves both pinned vendor definitions. A shared three-minute health wait now
requires the API, TorrServer and Jackett to be running and healthy together.
Failed startup or readiness reports selected container state/health/exit/OOM/restart
fields and retains the existing bounded API log output; it does not print vendor
logs, configuration or health-probe output. No takeover, data/settings mutation,
old-project shutdown, bind deletion or deployment-time Compose grep guard was added.

Fourteen new daemon-free workflow tests exercise the actual remote shell body,
including delayed readiness, missing/no-healthcheck/exited/restarting/unhealthy
services, health regression during startup, failed Compose startup, pull failure
before shutdown and unchanged full-stack command ordering. CI runs these alongside
the Compose fixtures. `node --test tests/*.test.cjs` passed 552 tests with no skips;
the pinned ES5 gate, example-env Compose rendering, actual release-transformation
fixtures, all 12 deployment shell blocks plus the remote body (`bash -n`), and
`git diff --check` passed. Backend code did not change, so Go checks are not
applicable. No workflow dispatch, container startup, production access, deployment,
settings writes or live acceptance was performed.

### Task 5: Write the manual handover documentation

**Files:**
- Create: `docs/container-migration-runbook.md`
- Modify: `docs/container-migration-inventory.md`

- [x] Document the final handover sequence from this plan: old-container stop,
  new deployment, verification, then obsolete-source cleanup.
- [x] Explain the current signal-handling caveat and graceful shutdown API as
  instructions only; implement no host shutdown or migration helper.
- [x] Distinguish removable deployment definitions from all retained bind data,
  especially `/opt/svtlvtv/jackett/config`.
- [x] Document upgrade-aware manual rollback, pre-upgrade configuration/database
  backups, saved-data/credential comparisons and expected deployment interruptions.
  Do not assume the old binary can read state rewritten by the newer release.
- [x] Validate paths, links and any command snippets locally. Do not execute the
  instructions or require the owner to verify them before this task completes.

Task 5 validation (November 9, 2026): added the manual cutover/runbook and
linked inventory guidance for consistent pre-upgrade backups, private saved-data
and credential comparisons, asynchronous graceful shutdown with restart handling,
upgrade-aware rollback, retained binds and post-verification source cleanup.
Matching MatriX.150 signal/shutdown sources were rechecked. Updated inventory
wording to reflect the completed healthchecks and deployment readiness wait.

Validated 13 local document links/anchors, all three bind pairs, workflow ordering
and readiness contracts, the diagram note and the single read-only shell snippet
with `bash -n` only. Documentation checks were local assertions; no artificial
unit tests were added for prose. `node --test tests/*.test.cjs` passed 552 tests
with no skips, including release rendering and deployment shell syntax/fixtures.
The pinned ES5 gate, example-env Compose rendering and `git diff --check` passed.
Backend code did not change, so Go checks are not applicable. No operational
instructions were executed: no production access, shutdown, backup, deployment,
settings writes, cleanup or live acceptance was performed.

### Task 6: Correct account error classification and diagnostics

**Files:**
- Modify: `svtlv/account-sync.js`, `tests/account-sync.test.cjs`
- Modify: `tests/account-state.test.cjs` if affected

- [x] Separate boot/load/background-read/apply/save error paths and add accurate
  English/Russian messages, preserving caller intent for save-preflight reads.
- [x] Preserve authentication expiry, dirty edits, storage-failure disablement,
  safe retries, failure-streak suppression and all account/baseline/revision guards.
- [x] Add bounded local diagnostics for phase, method/status/category and timing;
  exclude credentials, document bodies, user/token IDs and private setting values.
- [x] Add independent-client tests for guest/signed-in and account combinations,
  read/PUT/apply/storage failures, boot deadline, recovery, repeated errors and
  stale callbacks after account changes.
- [x] Pass account runtime and ES5 checks. Record the production incident as
  unreproduced rather than adding a live-device dependency or speculative socket fix.

Task 6 validation (November 9, 2026): boot, account-load, background-read,
apply, save and device-storage failures now have distinct English/Russian messages.
Save-preflight reads retain save intent, including when a save joins a pending
poll. Read/apply/save notice streaks recover independently; a successful GET does
not acknowledge failed saves. Same-account cache-apply failures can retry without
prematurely enabling uploads. Existing auth expiry, storage disablement, dirty
edits, encryption recovery and account/baseline/revision guards remain covered.

`window.svtlv_sync_diagnostics()` returns copies of at most 40 page-local metadata
records: phase, method, HTTP status, category, elapsed milliseconds and request
or deadline duration. Diagnostics are neither persisted nor sent anywhere and
exclude URLs, headers, credentials, bodies, identities, setting names/values and
exception text. Added 35 tests covering both languages, guest/same/different-account
independent clients, GET/PUT/apply/storage failures, deadline timing, joined reads,
recovery, failure suppression, stale account callbacks and diagnostic bounds,
redaction and copy isolation.

`node --test tests/*.test.cjs` passed 587 tests with no skips, including the
account state/runtime suites, release-transformation fixtures and syntax checks
for all 12 deployment shell blocks plus the remote body. The pinned ES5 gate
(`npx --yes acorn@8.14.0 --ecma5 --silent svtlv/*.js app.min.js`), example-env
Compose rendering and `git diff --check` passed. No shell or backend code changed;
Go checks are not applicable. The reported production incident remains
unreproduced: these regressions establish local error classification and client
isolation, not a proven cross-device delivery cause or a live incident fix.
No production access, device playback, deployment or socket changes were performed.

### Task 7: Share owned torrents across the two configured links

**Files:**
- Modify: `svtlv/torrserver-ownership.js`, `tests/torrserver-ownership.test.cjs`
- Modify: `tests/torrserver-one-link.test.cjs` if affected
- Modify: `backend/README.md`, `docs/design/settings-sync-backend-design.md`
- Modify: `tests/ownership-docs.test.cjs` only for changed documented contracts

- [x] Reuse existing endpoint normalization/digest logic to obtain both configured
  IDs, deduplicating equivalent URLs while preserving current IDs and fallback.
- [x] Union the current user's membership through existing API reads and intersect
  the active endpoint list; fail closed on errors and never contact the inactive
  TorrServer. Implement the equivalent guest-local behavior.
- [x] Keep claims scoped to the used endpoint. Release both memberships on removal
  without deleting the server torrent, reporting partial failure and allowing
  idempotent retry without a false success.
- [x] Fence results using both URLs and account/selection/operation generations,
  including away-and-back changes. Keep selector local and credentials shared.
- [x] Add automated shared/different-server, absent-torrent, duplicate/empty URL,
  hash, failure/retry and identity-race cases; retain original public `drop`
  behavior. Pass ownership/account/ES5 checks and update matching docs.

Task 7 validation (November 9, 2026): My Torrents now reads this user's
membership under both configured endpoint IDs, deduplicates equivalent normalized
URLs, and intersects the union with only the active endpoint's live list. Existing
SHA-256 IDs, public resolver/fallback, local selection, shared credentials and
endpoint-scoped claims remain intact. Guests use the equivalent local union.
Removal releases both account memberships sequentially, or both guest memberships
in one verified local-map write. Success requires every release; partial failure
notifies and refreshes the originating list, and retries repeat idempotent deletes.
No server torrent removal or inactive TorrServer request is introduced.

Both URL values, selection, account and scope generations fence pending work,
including inactive edits, equivalent aliases and away-and-back changes. New lists
and mutations invalidate stale list results; same-hash operation generations stop
superseded acknowledgements and delayed claims while independent hash claims
remain independent. Already sent requests can still commit; guards do not promise
server transaction cancellation. Public drop and direct playback callbacks retain
their behavior. Matching backend usage and design guidance were updated.

Added 55 regressions for shared-server aliases and different endpoints, absent
hashes, normalization/deduplication, canonical hashes, failed union reads, atomic
guest release, partial account release/retry, identity failures and scope/operation
races. Existing account/guest isolation, savedb, public-drop and routing checks
remain covered. `node --test tests/*.test.cjs` passed 642 tests with no skips.
The pinned ES5 command and separate Acorn checks for every `svtlv/*.js` file and
`app.min.js`, example-env Compose rendering, existing release/deployment shell
fixtures and `git diff --check` passed. No shell or backend code changed; Go checks
are not applicable. No production access, deployment, settings mutation or live
playback acceptance was performed.

### Task 8: Make built-in cancellation and timer cleanup safe for other viewers

**Files:**
- Modify: `app.min.js` only at affected built-in lifecycle paths
- Create: `tests/torrserver-playback.test.cjs`
- Modify: `.github/workflows/tests.yaml` to run the new automated tests

- [x] Characterize actual discovery/dialog/preload functions with mocked requests,
  timers and a shared fake server; identify automatic hash-wide drop calls.
- [x] Replace automatic close/discovery-timeout drops with local cleanup. Preserve
  explicit public `Torserver.drop`, membership-only removal and Timeline behavior.
- [x] End terminal discovery intervals, clear local requests and reject stale
  callbacks after cancel/reopen/replacement. Fix duplicate polling only where
  characterized; preserve necessary paused-reader behavior.
- [x] Check the reader-expiry contract against the selected stable target's source;
  do not introduce a cross-device viewer count based only on one tab's state.
- [x] Add success/error/timeout/repeated-open/late-response and simulated two-client
  regressions. Mark narrow bundle changes for upstream reapplication and pass
  Node/ES5 checks without waiting for real devices or server experiments.

Task 8 validation (November 9, 2026): characterized the actual shipped
connection/hash/discovery, file-dialog, preload, autostart and player-statistics
functions with mocked requests, timers and a shared fake server. Removed the two
automatic hash-wide drops. Discovery now terminates once on success or at the
existing 90-second deadline; it skips the final request that was immediately
cleared by the old timeout path. Close/replacement clears local requests, timers,
preload and autostart state. Dialog generations, terminal flags and countdown
identity reject queued callbacks, delayed seasons, detached file enters and stale
player returns. Back callbacks may open a new dialog without old cleanup erasing
its state. Narrow bundle edits are marked `svtlv` for upstream reapplication.

Repeated statistics setup now leaves one poller, with late stat/cache callbacks
fenced after replacement/destroy. The existing hidden/paused polling cadence and
GStreamer heartbeat remain intact. Explicit public `Torserver.drop` remains
destructive and unchanged; ownership-only removal and local Timeline behavior
remain covered by the existing and new suites. No tab-local viewer count was added.

Rechecked the selected MatriX.150 [reader lifetime source](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/torrent.go):
expiry requires zero cache readers, an elapsed deadline and working/closed state;
closing a reader extends the deadline. The [stream handler](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/web/api/stream.go)
uses `GotInfo` before `stat`, extending working-torrent lifetime. The separate
[background preload](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/preload.go)
can keep its own work/deadline active. Local cancellation stops this tab's work;
it does not promise immediate server preload cancellation or measured idle cleanup.
Live cleanup remains post-implementation acceptance.

Added 36 automated regressions, including two simulated clients sharing a hash,
connect/hash errors, discovery success/errors/timeout/deadline boundaries,
repeated opens, late responses, preload progress/stall/replacement, autostart,
player-stat replacement/destroy, Android/GStreamer paths and Timeline/playback
callbacks. CI runs the new suite and parses each add-on and the bundle separately
with pinned Acorn. `node --test tests/*.test.cjs` passed 678 tests with no skips.
One earlier full run reported an ownership test-process failure without an
assertion/error detail; that suite passed 229 tests in isolation and the full
rerun passed. The pinned plan ES5 command, per-file ES5 checks, example-env
Compose rendering, existing release-transformation/deployment-shell fixtures,
new frontend shell syntax (`bash -n`) and `git diff --check` passed. Backend code
did not change; Go checks are not applicable. No production access, deployment,
settings mutation, real-device playback or live server experiment was performed.

### Task 9: Implement the bounded resource-measurement collector

**Files:**
- Create: `devops/measure-playback.sh`, `devops/measure-playback.py`,
  `tests/playback-measurement.test.cjs`
- Create: `docs/parallel-playback-validation.md`
- Modify: `.github/workflows/tests.yaml` for relevant automated checks

- [x] Implement timestamped, duration-bounded collection of host/container CPU,
  current/peak memory, OOM, swap/reclaim, CPU/memory/I/O pressure, disk/network
  rates and configured service health. Handle missing metrics explicitly.
- [x] Track container/cgroup generations and accept playback event/bitrate/client
  annotations. Avoid private media identifiers and torrent requests that extend
  cache lifetime. Produce a documented result format for later comparisons.
- [x] Keep the collector read-only: no settings writes, streams, forced restarts,
  production load generation or cleanup mutations.
- [x] Add fixture tests for parsing, time bounds, restart generations, unavailable
  counters, errors and output redaction; validate shell syntax and Node behavior.
- [x] Document usage and example fixture output. Actual production collection is
  not required or performed as part of this task.

Task 9 validation (November 9, 2026): added a Bash launcher and a Python 3.8+
standard-library collector. Collection uses host proc files, cgroup v2 and one
filtered, deadline-bounded Docker inspection per sample. It records UTC and
monotonic times, CPU, current/kernel-peak memory, OOM/swap/reclaim, PSI, disk and
network counters/rates, and configured health. Missing metrics remain explicit;
container/cgroup generations and missing/reset counters fence rate baselines.
Strict appendable annotations accept public viewer/event/bitrate context and
reject private/free-form fields without echoing them. No application requests,
probes, streams, container mutation, settings reads/writes or load generation occur.
The companion Python file keeps parsing and lifecycle code reviewable without
adding a runtime package dependency or writing bytecode.

Added 42 fixture checks for parsing and rate units, time bounds, restarts,
replacement/cgroup changes, counter resets, unavailable/invalid counters, partial
Docker errors, command timeouts, signal termination, redaction, annotation
validation/appends/size bounds/nonregular files, CLI limits and documentation
links/shell/JSON examples. CI runs the fixtures and shell syntax check. The full
`node --test tests/*.test.cjs` suite passed 720 tests with no skips after correcting
a fixture that unintentionally renamed an interface during a rate comparison.
The pinned plan ES5 command and per-file ES5 parsing, example-env Compose rendering,
existing release-transformation/deployment-shell fixtures, `bash -n` and
`git diff --check` passed. Backend code did not change; Go checks are not applicable.
Documentation distinguishes fixture output, unavailable coverage and kernel peaks
from measured capacity. No production collection, deployment, playback, settings
mutation or live acceptance was performed. Tasks 10–12 remain unimplemented.

### Task 10: Package the tuning candidates and acceptance procedure

**Files:**
- Modify: `docs/parallel-playback-validation.md`, `docs/container-migration-runbook.md`
- Modify: this plan's final handover only if implementation changes usage

- [x] Document source-supported candidate fields, units, aggregate-cache math and
  trade-offs: 512 MiB cache first, then 4% preload as a separate trial.
- [x] Document how later measurements determine overhead, host headroom and
  supported resource boundaries. Keep unmeasured caps/runtime knobs unapplied.
- [x] Document separate Jackett search-overhead trials without removing indexers,
  changing keys or introducing unsupported concurrency options.
- [x] Include the final workload matrix, stop/success criteria, full-settings
  merge/readback/rollback procedure and 4K-selection contract in the handover.
- [x] Validate fields/units and settings-save semantics against the selected stable
  target's source rather than relying solely on the MatriX.143 audit, and usage
  against the collector. No trial results, user decisions or live changes are
  prerequisites; label candidates and capacity as unverified.

Task 10 validation (November 9, 2026): packaged staged 512 MiB cache-only
and separate 4% preload trials, aggregate-cache/preload math, optional later
read-ahead/peer comparisons, unchanged runtime/resource boundaries, full-settings
merge/readback/rollback, separate fixed-indexer search trials and the final
playback/account/membership workload matrix. The handover includes numeric
baseline-derived stop thresholds, the proposed 20% latency gate, three repeated
startup/seek/cancellation cases, 60-minute three-viewer sustain and 10-minute
cleanup, unrestricted single-viewer 4K and optional mixed/three-4K coverage.
Candidates, capacity and actual incident cause remain explicitly unverified.

Rechecked 14 public references and the selected MatriX.150 settings model, UI
conversion, per-hash cache/reader allocation, preload math, API handler and
save/reconnect implementation. The target still replaces the full settings
object and drops active torrents; documented that HTTP 200 can coexist with
read-only mode or failed reconnect. Collector usage matches its duration limits,
annotation schema, generation/missing-metric semantics and measurement limits;
latency/codec/search fan-out require companion observations.

Eight local document links/anchors, four shell snippets (syntax only), JSONL
examples, source-contract assertions and candidate arithmetic passed. Existing
collector fixtures validate the documented examples; no artificial prose unit
tests were added. `node --test tests/*.test.cjs` passed 720 tests with no skips,
including release-transformation/deployment-shell and collector fixtures. The
pinned ES5 gate, example-env Compose rendering, collector `bash -n` and
`git diff --check` passed. Backend code did not change, so Go checks are not
applicable. No operational snippets were executed. No production access,
deployment, settings writes, live collection or playback acceptance was performed.
Tasks 11–12 remain unimplemented.

### Task 11: Run implementation acceptance checks

**Files:**
- Modify: this plan to record repository check results
- Modify: affected tests/configuration only if a check reveals an implementation issue

- [x] Run `node --test tests/*.test.cjs` and
  `npx --yes acorn@8.14.0 --ecma5 --silent svtlv/*.js app.min.js`.
- [x] Run `docker compose -f devops/docker-compose.yaml --env-file devops/.env.example config --quiet`,
  validate the release transformation locally, and syntax-check changed shell.
- [x] Run applicable Go checks only if backend code changes; report actual check
  coverage and any missing tooling honestly, without asking for a release/deploy.
- [x] Verify every agreed feature has its code/configuration/docs and automated
  coverage, and all operational scenarios are documented in the final handover.
- [x] Record repository results separately from unperformed live acceptance.
  Finish this task without production access, manual playback or owner input.

Task 11 validation (November 9, 2026): repository acceptance passed locally
on macOS/arm64 with Node v24.21.0, npm 11.19.0, Docker Compose v5.6.1,
Python 3.9.6 and Bash 3.2.57. The full `node --test tests/*.test.cjs` suite
passed 720 tests, with zero failures, cancellations or skips. The specified
`npx --yes acorn@8.14.0 --ecma5 --silent svtlv/*.js app.min.js` command and
separate pinned Acorn parses of every add-on and the bundle passed.

Example-env Compose rendering passed. The suite executed the actual release
transformation against temporary fixtures, confirmed unchanged vendor service
pins/configuration, networks and volumes, and checked web/API image rewriting and
build-block removal. On macOS the fixture adapts only the BSD `sed -i` backup
argument; the Linux deployment workflow was not executed. Missing/empty required
environment fields, malformed secrets and invalid ports were rejected. All 12
deployment shell blocks plus the remote body passed `bash -n` in the suite;
additional syntax checks passed for all 14 multiline CI/deployment blocks and
`devops/measure-playback.sh`. Sixteen inventory/runbook/validation local links
and anchors, four documented shell snippets (syntax only), JSON/JSONL examples
and `git diff --check` passed.

Feature-to-deliverable review confirmed the following coverage; the full suite
also retains the existing account, settings, loader, routing and documentation
guards. No implementation defect required code/configuration changes or new tests
in this acceptance-only task.

| Agreed behavior | Implementation and automated coverage | Handover documentation |
| --- | --- | --- |
| Stable vendor pins, exact retained binds, ports, aliases, runtime and non-stream healthchecks | `devops/docker-compose.yaml`; `tests/container-compose.test.cjs` | Inventory and runbook |
| Full-stack release lifecycle, shared readiness deadline and bounded failure reporting | `.github/workflows/deploy-docker.yaml`; `tests/deployment-workflow.test.cjs` and release-rendering fixtures | Runbook cutover, rollback and later redeployment |
| Accurate account phases, save intent, bounded private-data-free diagnostics and client isolation | `svtlv/account-sync.js`; `tests/account-sync.test.cjs` and `tests/account-state.test.cjs` | Validation workload matrix and actual account-warning handover |
| Two-link membership union, active-list intersection, endpoint claims, both-ID release and identity/race fences | `svtlv/torrserver-ownership.js`; `tests/torrserver-ownership.test.cjs`, `tests/torrserver-one-link.test.cjs` and `tests/ownership-docs.test.cjs` | Backend README, sync design and validation matrix |
| Local cancellation, terminal timers, stale-response rejection, preserved public drop/Timeline and paused-reader behavior | Marked `app.min.js` edits; `tests/torrserver-playback.test.cjs` plus ownership/routing checks | Validation lifecycle cases and reader-expiry limits |
| Bounded read-only resource collection, generations, missing metrics, annotations and redaction | `devops/measure-playback.sh`, `devops/measure-playback.py`; `tests/playback-measurement.test.cjs` | Validation usage, result format and fixture examples |
| Staged unverified tuning, complete-settings apply/readback/rollback, three-viewer 1080p and unrestricted single-viewer 4K acceptance | Documentation-only candidates; collector fixtures check documented shell/JSON examples; no candidate settings applied | Validation candidate units/math, workload matrix, stop gates and final plan handover |

The final handover covers initial old-writer shutdown and consistent backups,
fixed-name/port release, exact-bind adoption, private data/credential comparisons,
upgrade-aware recovery, retained `/opt/svtlvtv/jackett/config`, obsolete-source
cleanup, later redeployment, LAN/tailnet playback, search overhead, account/guest
and membership isolation, repeated cancellation/seek/startup, 60-minute sustain,
10-minute cleanup and optional mixed/three-4K trials. Numeric host thresholds,
live measurements and settings promotion remain later owner-operated work.

Backend changes since implementation began are confined to `backend/README.md`;
no Go code, module, migrations or backend build configuration changed. Go lint,
test and race checks are therefore not applicable and were not run. No required
local check was unavailable or skipped. Linux CI, the destination's Compose v1,
image/runtime execution, real browser/TV playback, production access, deployment,
shutdown, backup, settings writes, collection and live acceptance were not
performed. Automated checks establish repository behavior, not a reproduced
production incident, successful migration or measured playback capacity.
Task 12 remains unimplemented; backlog cleanup, final guidance and archival are
reserved for that iteration.

### Task 12: Finalize docs, remove resolved backlog items and archive the plan

**Files:**
- Modify: `backend/README.md`, `AGENTS.md`, `CLAUDE.md` where guidance changes
- Modify: `docs/design/settings-sync-backend-design.md`
- Modify: the inventory, runbook and validation documents created above
- Delete: resolved files from `docs/backlog/`
- Move: this plan to `docs/plans/completed/`

- [x] Publish final service/configuration/error/membership/lifecycle behavior and
  all post-implementation usage instructions. Keep secrets/private logs outside Git.
- [x] Validate documentation links/snippets and update references to deleted
  backlog files with closing-change references when available.
- [x] Delete every resolved backlog item with `git rm` and verify no completed
  item remains. Do not merely mark resolved items in prose.
- [x] Keep any genuinely unresolved incident/capacity objective explicit with its
  post-implementation follow-up; do not claim a live fix or measured capacity from
  unit tests. Such follow-up cannot hold this implementation plan open.
- [x] Mark repository tasks complete, archive the plan and report implementation
  results plus the final handover. Do not wait for release/deployment or perform
  any owner-operated action to finish implementation.

Task 12 validation (November 9, 2026): finalized service/readiness, account
error/diagnostic, cross-link membership and local cancellation guidance in
`AGENTS.md`, `CLAUDE.md`, the backend README and sync design. Corrected stale
Tailscale-specific web-binding and API-only readiness descriptions to match the
current all-interface `8092:80` publication and shared API/vendor deadline.
The backend local-run example now selects web/API with the DB dependency rather
than also starting fixed-name vendor services on production-style absolute binds.
Inventory, runbook and validation docs link to this archived completion record
and distinguish repository results from unperformed operational work.

Deleted both resolved implementation backlog files with `git rm`. Replaced the
older archived two-link plan's deleted-backlog link with Task 7 and commit
`6972aea`. Retained one narrowed incident/capacity item, preserving the historical
OOM and actual warning evidence through commits `2162282` and `0ac7703`.
It tracks live cutover, warning attribution, workload/cleanup measurement and
settings promotion without reopening completed implementation tasks. No completed
implementation objective remains in the active backlog.

`node --test tests/*.test.cjs` passed all 720 tests with no failures,
cancellations or skips, including release transformation, readiness and collector
fixtures and existing documentation/schema guards. The specified pinned ES5
command plus separate parses of every add-on and the bundle, example-env Compose
rendering, collector `bash -n` and `git diff --check` passed. Documentation checks
covered all 10 changed/archived documents, their local links and anchors, nine
shell snippets (syntax only), nine JSON/JSONL examples, deleted-backlog link
absence and five implementation/evidence commit references. This task changed
only documentation; no artificial prose tests or Go checks were needed. No
required local tooling was unavailable or skipped.

All repository tasks are complete and this plan is archived under
`docs/plans/completed/`. Later owner actions remain in the runbook, validation
procedure, follow-up and handover below. No production access, release/deployment,
shutdown, backup, settings writes, live collection, browser/TV playback or
capacity acceptance was performed or claimed.

## Evidence references

These support the embedded findings; they are not dependencies on private
production documents or additional owner actions.

- Historical investigation is retained in Git (`2162282` for resource/OOM
  findings, `0ac7703` for the warning arrangement). Resolved implementation
  backlog files were deleted; account classification landed in `dadd0cd`,
  cross-link membership in `6972aea`, and local cancellation in `9ec81a8`.
  Remaining incident/capacity follow-up (historical document; retained in Git history)
  tracks live evidence only. Implementation scope is restated above.
- [MatriX.143 signal handling](https://github.com/YouROK/TorrServer/blob/5c812ec1abe4c8e0acee29d820f78205a8f0e7b7/server/cmd/preconfig_pos.go),
  [shutdown API](https://github.com/YouROK/TorrServer/blob/5c812ec1abe4c8e0acee29d820f78205a8f0e7b7/server/web/api/shutdown.go),
  [database-closing shutdown](https://github.com/YouROK/TorrServer/blob/5c812ec1abe4c8e0acee29d820f78205a8f0e7b7/server/torr/apihelper.go)
  and [reader lifetime](https://github.com/YouROK/TorrServer/blob/5c812ec1abe4c8e0acee29d820f78205a8f0e7b7/server/torr/torrent.go).
- [LinuxServer Jackett image documentation](https://docs.linuxserver.io/images/docker-jackett/)
  and [Compose service reference](https://docs.docker.com/reference/compose-file/services/).
- Verified stable releases: [TorrServer MatriX.150](https://github.com/YouROK/TorrServer/releases/tag/MatriX.150),
  [Jackett v0.24.3030](https://github.com/Jackett/Jackett/releases/tag/v0.24.3030),
  [LinuxServer image v0.24.3030-ls30](https://github.com/linuxserver/docker-jackett/releases/tag/v0.24.3030-ls30).
- Target-version [container entrypoint](https://github.com/YouROK/TorrServer/blob/MatriX.150/docker-entrypoint.sh),
  [settings units](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/settings/btsets.go)
  and [reader expiry](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/torrent.go).

## Post-implementation handover: all owner-operated actions

**This section starts after implementation has finished and the plan can already
be archived. Nothing below is a prerequisite for completing Tasks 1–12.** The
owner controls when to release, deploy, perform the initial cutover and run live
checks. These actions are instructions for later execution, not agent tasks during
implementation. No live capacity, migration or incident verification is claimed.

### Release, initial manual cutover and old-source cleanup

1. Review the completed repository changes and release/deploy at the chosen time.
   Keep the old definitions and image references available for rollback. This
   deployment also upgrades both applications: take a consistent pre-upgrade
   backup of full configuration/databases/credentials and account for any residual
   writable state here, not during repository implementation. Check the delivered
   target-version compatibility notes before starting the newer binaries.
2. Stop the old TorrServer and Jackett containers and free their names/ports.
   Account for `TS_DONTKILL=1`: the supported `GET /shutdown` closes TorrServer's
   client/database and exits, but automatic restart must be accounted for. This
   GET is mutating, not a health probe. Confirm the old writers have stopped.
3. Deploy this repo's Compose stack against exactly the existing three binds.
   No data import or copying is needed. Never run old and new writers against
   the same writable configuration at once.
4. Verify expected image/runtime versions, commands, ownership/mounts, saved
   torrents/settings, Jackett indexers/API key, client LAN/tailnet endpoints and
   internal `jackett:9117` Torznab connectivity. Keep private comparison values
   out of logs. Check readiness and other known consumers.
5. If verification fails, stop the new writers and preserve any post-upgrade
   changes. Use the retained old definitions only with data known compatible with
   that version, or restore/reconcile the pre-upgrade backup. Do not assume a
   downgrade can safely use upgraded files or silently discard new writes.
   Keep unrelated services and shared networks intact.
6. Only after successful verification, remove obsolete old deployment sources
   under `/opt` and retire their old deployment entry point. **Keep the active
   `/opt/svtlvtv/jackett/config` bind**, `/var/lib/torrserver/config` and
   `/var/lib/torrserver/cache`. Removing old sources must not remove live data.

The old source repository/automation and additional consumers were not established
by the inventory. Any necessary production check of these belongs to this manual
handover and does not reopen the implementation tasks.

### Verify normal full-stack redeployment

Perform a later normal deployment and confirm TorrServer and Jackett stop/start
with the other services while their data, settings and credentials survive.
Verify API/TorrServer/Jackett readiness and failed-startup reporting. Playback
interruption during this deliberate deployment is expected.

If a separate container rehearsal is useful, use isolated explicit names, ports,
networks and synthetic data paths: a new Compose project name does not isolate
fixed `container_name` values. Use a compatible Linux/amd64 host or explicit
emulation for the production pins on ARM.

### Live measurement and tuning

Follow the delivered measurement and acceptance procedure (historical document; retained in Git history)
and runbook tuning handover (historical document; retained in Git history).
They contain the complete target-source contract, settings procedure, workload
matrix, gates and result record. The collector's 4200-second example covers a
60-minute sustain plus 10-minute cleanup; measure setup/reference/repeated cases
separately or extend the bounded duration. Latency, codec, search fan-out and
numeric stop thresholds belong in the companion record, not extra annotation
fields. Neither candidates nor capacity have been verified by live trials.

Run the delivered collector and annotate viewer start/seek/stop events, bitrate,
player/platform and network route. Correlate CPU/memory/swap/pressure with
playback and neighboring-service health. Do not deliberately replay the unsafe
three-torrent 2 GiB-per-hash profile on production merely to obtain a baseline.

| Setting | Recorded baseline | Trial |
| --- | --- | --- |
| `CacheSize` | `2147483648` bytes | `536870912` bytes, 512 MiB per distinct torrent |
| `PreloadCache` | `1` percent | First retain `1` for the cache-only trial; then test `4` separately |
| `ReaderReadAHead` | `95` | Retain initially; optional later `80` redistributes ahead/behind rather than reducing total cache |
| `ConnectionsLimit` | `25` | Retain initially; optional later `16` may trade throughput for lower peer work |
| `UseDisk` / `ResponsiveMode` | `false` / `true` | Retain initially |
| `TorrentDisconnectTimeout` | `30` seconds | Retain initially; verify reader/poller cleanup |
| rate limits / upload | unlimited / enabled | Preserve initially; no blanket restriction on 4K choice |

These are trials, not proven defaults. Three 512 MiB caches total 1.5 GiB nominal
payload, not a process RSS limit. Measure overhead and host-neighbor headroom
before choosing memory/swap/CPU/runtime boundaries. A cgroup OOM still means
playback failed. Do not assume Swarm-only limits constrain standalone Compose.

Apply candidates one variable at a time during an idle window using the selected
target's documented settings API. The MatriX.150 handler uses `POST /settings`
with `action=get` for the full snapshot and `action=set` with the full merged
object under `sets`. It retains full-object replacement and torrent/client reset;
HTTP 200 alone does not prove a save or successful reconnection. Preserve all
fields, compare full readback, check functionality and keep complete rollback
snapshots per stage. Stop workloads before restoring a full snapshot during an
idle window. Never send a sparse replacement, use `action=def` for rollback or
assume file edits hot-reload.

Measure Jackett searches separately from steady streaming: concurrent searches,
indexer fan-out, latency, retries and resource usage. Preserve all configured
indexers/keys/cookies and consumers. Introduce no unsupported concurrency flag,
proxy/helper, disk-cache conversion, aggressive GC or extra server instance merely
to improve a benchmark. Keep useful account sync and local player/link selection.

### Playback and viewer-isolation acceptance

Test idle, one 1080p stream, two/three distinct 1080p torrents, and two/three
readers of one torrent. Include simultaneous preload, steady playback, seeking,
pause/resume, discovery timeout, closing one viewer's dialog, one viewer stopping
while the others continue, and cleanup after all viewers stop. Exercise LAN and
tailnet routes plus concurrent Jackett searches with a fixed indexer set.

Verify single-viewer 4K with the actual codec/player and bitrate recorded. 4K
selection stays unrestricted. Mixed or three-4K trials are optional; resolution
alone is not a bandwidth specification or a guaranteed capacity claim.

Repeat startup/seek/cancellation cases three times per candidate. Sustain the
required three-viewer workload for at least 60 minutes, then observe cleanup for
at least 10 minutes after all readers and pollers stop. Do not poll torrent
status/cache endpoints to measure idle expiry when those calls extend lifetime.

Set numeric headroom/pressure/latency stop thresholds using the safe baseline
before the live trial. Require no unexpected OOM/restarts, cross-viewer
interruption, severe sustained reclaim/swap pressure or neighboring-service
failure. Record buffering and absolute startup/seek latency; the proposed latency
gate is no more than 20% worse than the safe one-viewer reference under comparable
content/network conditions. Abort and revert on pressure or playback regression.
Planned full-stack deployments run outside these capacity trials.

Check My Torrents across both configured URLs, account/guest isolation, partial
removal failure and local link/player selection. Verify that cancel/close/timeout
on one same-hash viewer does not drop another viewer's active stream. Distinguish
live cache from saved records and retained Go heap before judging cleanup.

### Actual account-warning verification

Use the reported arrangement: one anonymous client and one signed-in client,
with simultaneous playback. Capture the signed-in client's sync phase, request
result/timing and backend health/resource context without tokens or private data.
Verify accurate read/save error messages and recoverable dirty edits. Supplement
with same-account, different-account and guest-pair cases. Record actual app/plugin
versions; similar local messages are not proof of cross-device delivery.

### Record results, promote settings and close remaining follow-up

Record actual baseline/candidate values, measurements, coverage, failures,
platforms/bitrates, limits and rollback decisions in
`docs/parallel-playback-validation.md`. Keep or revert settings using those
results. Later changes to durable resource limits/runtime defaults are follow-up
configuration changes with their own checks, not unfinished implementation tasks.

Close/delete any remaining incident/capacity backlog item only when its outstanding
work is resolved. Do not claim a reproduced cause, successful migration or proven
three-viewer capacity from automated tests alone. Release/deployment, trial results
and later backlog closure remain separate from the already completed implementation.
