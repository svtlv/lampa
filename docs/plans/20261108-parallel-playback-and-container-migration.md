# Migrate TorrServer and Jackett and support parallel playback

## Overview

Bring the existing TorrServer and Jackett deployments under this repository's
`devops/docker-compose.yaml`, preserving configuration, credentials, endpoint
addresses and application versions. Migrate first, verify the transfer, then tune
and measure performance separately. Apply all three current backlog items.

The required capacity target is **three simultaneous 1080p streams**, including
three distinct torrents. Also verify single-viewer 4K playback. Keep 4K available
by user choice: no resolution filter, admission rule based on resolution, forced
downgrade or blanket bitrate cap. Three simultaneous 4K streams are an optional
capacity experiment, not a release requirement or a promised capability.

This is an implementation plan, not authorization to perform a production
cutover or disruptive playback experiment during planning.

## Decisions and evidence

- Owner selected: preserve existing URLs, ports, credentials and versions; migrate
  first, tune separately. Do not bundle an application upgrade into the move.
- Owner selected: three 1080p viewers as the capacity target; preserve the choice
  to watch 4K, including when only one viewer is present.
- Initial inspection was on `svtlvtv` at `2162282`; concurrent upstream integration
  advanced the checkout to `efbff45` during planning. The account-error and
  hash-wide cancellation paths were rechecked and still exist; bundle line
  numbers/private identifiers have moved. Concurrent storage-policy/test edits
  were left intact. Reconcile their final state before implementation. This is a
  distribution checkout: frontend changes use ES5 and direct bundle edits only
  for built-in behavior. Add-on changes stay in `svtlv/` and use public Lampa APIs.
- Historical production findings in the backlog identify TorrServer MatriX.143
  with a 2 GiB **per distinct torrent** RAM cache. On November 7 the kernel
  recorded a global OOM kill of TorrServer at approximately 7.3 GiB anonymous
  resident memory with swap exhausted. This proves an OOM victim, not a leak or
  a particular initiating playback request.
- Current code confirms that failed background account reads use the save-error
  toast, and that torrent file-dialog cancellation/discovery timeout send
  hash-wide `Torserver.drop` requests. Neither proves the cause of the owner's
  actual device warning or a real cross-viewer interruption.
- Production inventory requested through the configured Hermes `svtlv` peer,
  using a fresh API run after its existing Bot Chat rejected admission.
  Initial run: `run_28951de6be9d44d4b1fb143782770fd8`. Its completed response
  confirms the 512 MiB/4% candidate is unapplied and releases use stack-wide
  `docker-compose down`; it reports no production modifications. Detailed
  inventory returned in follow-up `run_68fd1ea54c3147909c00eef0b6ecee41`, based on
  read-only observations **November 8, 09:49–09:55:51 UTC**. Its relevant facts
  and remaining unknowns are recorded below. No settings saves, restarts,
  deployment, stream probes or load tests were performed.

## Production inventory from Hermes

### Deployment ownership and versions

| Contract | Current state to preserve |
| --- | --- |
| Old Compose project | `torrserver` |
| Authoritative old live definition | `/opt/svtlvtv/torrserver/docker-compose.yml` |
| Old working directory | `/opt/svtlvtv/torrserver` |
| Source repository / installer / redeployer for that file | **Unknown; must identify before transferring ownership** |
| Service and container names | `torrserver`, `jackett` |
| Destination project / live file | `svtlvtv`; `/home/deploy/svtlvtv/docker-compose.yaml` |
| Destination source | This repo's `devops/docker-compose.yaml` |
| TorrServer version / architecture | MatriX.143, `linux/amd64` |
| Jackett image / app / runtime | `v0.24.2475-ls9` / `v0.24.2475` / `9.0.19`, `linux/amd64` |

Use these installed image references as migration inputs, subject to pre-cutover
digest/architecture reconciliation:

```text
ghcr.io/yourok/torrserver@sha256:9a6b95f5744af2fcff55c505891c737f22dd6e1d3d53269fc2268ef3382507d9
lscr.io/linuxserver/jackett@sha256:341ace61a953dd404892abd319ac6c871e39189c8e0a9cf618d03666a7620fa1
```

Both current image references are mutable/untagged. Jackett actually runs
`/app/Jackett/jackett --NoUpdates`; `AUTO_UPDATE` is absent and no application
writable-layer changes were observed. Preserve effective update behavior even
though persisted `UpdateDisabled=false`. TorrServer runs as root with
`--path /opt/ts/config --logpath /opt/ts/log --port 8090 --torrentsdir /opt/ts/torrents --dontkill`;
environment includes `TS_DONTKILL=1` and `GODEBUG=madvdontneed=1`.
The pinned MatriX.143 source audit confirms `--dontkill` ignores process
termination signals; it does not disable torrent idle expiration. Ordinary Docker
stop can therefore escalate to a forced kill. The migration must disable automatic
restart temporarily, use the supported graceful shutdown API, verify actual exit,
then take the stopped-writer backup. Do not change this flag as an incidental
migration setting; assess normal signal handling separately afterward.

### Persistent state and in-place adoption

These are all mounts on the two current containers; there are no named or
anonymous volumes. None is mounted by another current container.

| Existing host bind | Container path | Owner / directory mode | Required preserved state |
| --- | --- | --- | --- |
| `/var/lib/torrserver/config` | `/opt/ts/config` | `0:0`, `0755` | `settings.json` (1,388 B), `config.db` (8,388,608 B, BBolt saved torrents/viewed state), `rutor.ls` (51,173,624 B search state); files `0644` |
| `/var/lib/torrserver/cache` | `/opt/ts/torrents` | `0:0`, `0755` | Empty at inspection; `UseDisk=false`, so this is not the active RAM cache |
| `/opt/svtlvtv/jackett/config` | `/config` | `1000:1000`, `0755` | Whole directory, approximately 1.71 MB logical: `Jackett/ServerConfig.json`, `Jackett/Indexers` (24 JSON and 20 backup files), DataProtection state, API/admin credentials and cookie-bearing configuration |

All binds are read/write on the host root ext4 filesystem. **Keep these exact
host paths for the initial move**; the user requested moving service ownership,
and relocation is unnecessary. Take a consistent backup regardless of in-place
adoption. No complete backup or successful restore was verified. Jackett's
individual `.bak` files are not a complete rollback artifact.

`accs.db` and `trackers.txt` were absent; TorrServer HTTP-auth enabling environment
was absent. Preserve the current auth contract, without inventing credentials or
turning authentication on/off during migration. Trackers may still exist inside
saved records. Preserve any client-side stored credentials without changing
account documents. Jackett API/admin secret values were not collected in the
report; its Torznab key matches TorrServer's configured key.

The writable layers are small (TorrServer approximately 743 KB, Jackett 23 KB).
TorrServer logs live at unmounted `/opt/ts/log`; Jackett temporary files use
`/run/jackett-temp`. Detailed unmounted files/certificates/download state could
not be fully read due to permissions; classify/export any required residual
state before deleting containers. Do not bypass that access boundary or assume
the mount list alone proves all important state has been backed up.

### Network and runtime contract

- Current networks: `torrserver_default` (only these two containers) and shared
  `svtlv_monitoring_external`. Preserve aliases `torrserver` and `jackett`.
  Destination can use its default network plus the existing monitoring network;
  validate consumers before retiring the old dedicated network.
- Host bindings: TorrServer `8090/tcp`, Jackett `9117/tcp`, on existing IPv4/IPv6
  interfaces. No UDP ports are currently published; do not add/change peer
  exposure during migration. Peer listen port remains dynamically selected.
- TorrServer calls `jackett:9117/api/v2.0/indexers/all/results/torznab/`; preserving
  this alias, route and API key is mandatory even if client URLs stay unchanged.
- Jackett has no configured FlareSolverr/proxy endpoint; no FlareSolverr or VPN
  container was found in the 25-container inventory. Do not introduce either.
  Other external consumers and actual per-device endpoints remain unverified.
  Preserve existing LAN/tailnet reachability; Tailscale Serve was empty.
- Both use `unless-stopped`; neither has explicit CPU/memory/swap/PID limits or
  Docker healthchecks. Logging is `json-file` without explicit per-container
  rotation. Reproduce this baseline first; any limits/logging tuning is separate.
- Jackett environment: `PUID=1000`, `PGID=1000`, `TZ=Asia/Jerusalem`,
  `XDG_DATA_HOME=/config`, `XDG_CONFIG_HOME=/config`, `TMPDIR=/run/jackett-temp`.
  Preserve `Port=9117`, `LocalBindAddress=127.0.0.1`, `AllowExternal=true`,
  `AllowCORS=false`, `CacheEnabled=true`, `CacheTtl=2100`,
  `CacheMaxResultsPerIndexer=1000`, `FlareSolverrMaxTimeout=55000`.
  Blackhole/base-path/base-URL overrides are null; do not create a downloads
  mapping without establishing a real need. Full private ServerConfig is adopted,
  not regenerated from this nonsecret summary.

### Capacity evidence and unresolved prerequisites

At 09:51 UTC the host had an Intel N150 with four logical CPUs, 15.365 GiB RAM,
3.752 GiB available, approximately 4 GiB swap with 3.489 GiB used, zero recent
memory PSI averages, and low sampled CPU activity. Neighbors include three Kafka
brokers at approximately 1 GiB each, Aspire at 1.165 GiB and Immich server at
1.027 GiB plus databases, Keycloak and other services. Idle recovery is not proof
that three viewers fit. The approximately 713 GiB free root storage does not
justify switching streaming to disk caching by default.

Passive network observations and a 1 Gbit/s Ethernet link do not establish
available WAN/tailnet throughput. Measure actual playback bitrates and available
network performance in the later controlled trials.

Fresh effective TorrServer settings matched `settings.json`: the cache/preload
table below remains current, `TrackTimecode=false`, `StoreSettingsInJson=true`,
`StoreViewedInJson=false`, `EnableRutorSearch=true`, `EnableTorznabSearch=true`,
`EnableDLNA=false`, `EnableIPv6=false`, with no download/upload rate limit. Keep
the entire original settings object, including unlisted fields and secrets.

Before implementation/cutover, resolve the old source/redeployment owner,
complete backup/restore and residual writable-state verification, inventory other
consumers/client endpoints, agree the idle window and workload stop thresholds,
and verify exact-version idle-reader cleanup on real devices. These are explicit
unknowns; no configuration migration or three-viewer capacity is yet proven.
Private supporting docs are under `/home/svtlv/server-admin/` in `SERVICES.md`,
`RUNBOOKS.md`, `INCIDENTS.md` and the November 6–7 incident reports. The service
document is historical; the timestamped live inventory takes precedence.

## Backlog coverage and completion criteria

| Existing item | Planned work | Closure evidence |
| --- | --- | --- |
| [Share owned torrents between links](../backlog/share-torrents-between-torrserver-links.md) | Task 7 | Union both membership sets, intersect the active endpoint's live list, remove this user's ownership from both, and pass account/guest/race regressions |
| [Isolate device-local messages](../backlog/isolate-messages-between-parallel-devices.md) | Task 6 and manual device verification | Distinguish local refresh/load/apply/save failures; test isolated clients; verify the owner's guest plus signed-in arrangement; record whether the original incident was actually reproduced |
| [Parallel playback and resource peaks](../backlog/parallel-playback-resource-peaks-and-configuration.md) | Tasks 2–5 and 8–10, then operational trials | Consistent migration, measured memory/cleanup profile, no OOM/reclaim collapse or cross-viewer interruption during the stated workload, with host headroom and rollback evidence |

The messages item's title predates its narrowed findings. Do not implement CUB
recipient filtering, change device identifiers, stop sharing the CUB account, or
disable synchronization as a claimed fix for the local toast. Adjacent queued
socket/callback observations are not established incident causes; investigate
them further only if new evidence makes them necessary to resolve this item.

Keep backlog files until their respective work and verification land; remove an
item with the change that closes it. A code fix or healthy `/echo` response alone
does not close the performance item. Record an unreproduced incident honestly.

## Context and files

- `devops/docker-compose.yaml`: web, API and PostgreSQL; external monitoring
  network; stable production project identity is derived from the deploy path.
- `devops/.env.example`: local placeholders; production `.env` is regenerated by
  `.github/workflows/deploy-docker.yaml`, so new required variables must be
  supplied there rather than hand-added to a file the next deploy overwrites.
- `.github/workflows/deploy-docker.yaml`: manual deployment from the default
  branch, image rewriting/build-block stripping, currently runs stack-wide
  `down` before `up`. That lifecycle would interrupt streams on ordinary web/API
  releases after the new services join this stack.
- `.github/workflows/tests.yaml`: ES5 parsing, Node runtime checks, backend
  tests/race/lint, Compose rendering using the example environment.
- `svtlv/torrserver-ownership.js`: endpoint-derived identity, per-user API and
  guest-local membership; currently lists/removes only the effective endpoint.
- `svtlv/account-sync.js`: local account status, errors, dirty state, retries,
  baseline/revision guards and polling. Both compiled dictionaries remain
  untouched; add-on strings are inline English/Russian.
- `app.min.js`: built-in file discovery, modal close, preload and player status
  loops. Narrow built-in lifecycle fixes must preserve the exported API and the
  existing removal of shared TorrServer timecodes.
- Existing runtime tests in `tests/`; membership API in
  `backend/pkg/api/torrents.go` already provides endpoint-scoped list/claim/release
  without contacting TorrServer. No backend schema change is needed for unioning
  two membership sets.
- Root `.dockerignore` already excludes `docs`, `devops` and `tests`. Keep all
  operational artifacts there; no new public image directory is necessary.

## Development approach and testing

- Use the existing regular approach: focused implementation followed by targeted
  behavioral regressions in the same task. Pass each task's checks before moving
  to its dependents. Documentation-only tasks need document/snippet validation,
  not artificial unit tests mirroring their text.
- Keep migration, application fixes and tuning independently reviewable and
  reversible. Pin actual running third-party versions/digests; defer upgrades.
- Add/update success, failure and asynchronous lifecycle tests for code changes.
  Use the existing Node VM patterns to exercise actual add-on/bundle code.
- Run `node --test tests/*.test.cjs` and the pinned ES5 gate. Any bundle change
  also needs ES5 parsing and browser/TV checks; syntax parsing cannot detect
  unsupported post-ES5 APIs.
- Validate Compose with its example environment in CI and the actual production
  Compose version in a rehearsal. Do not introduce release-time grep guards for
  Compose structure, tags or exact port bindings.
- Backend code is expected to stay unchanged. If scope requires backend changes,
  add matching Go regressions and run `make test`, `make race`, `make lint` and
  formatting in a supported Linux/WSL/CI environment with Docker required for DB
  coverage. Do not report skipped DB tests as successful database validation.
- Mark completed checkboxes immediately. Update this plan when evidence changes
  the approach; do not mark external acceptance complete on repository tests.

## Solution overview

### Preserve service identity while transferring deployment ownership

First reproduce each existing service contract in this repository: exact runtime
version, persistent storage, UID/GID, command/environment, ports/protocols,
networks/aliases, proxy behavior and dependencies. Preserve client-visible
TorrServer LAN/tailnet URLs and Jackett URL/API key so account documents, plugins,
other consumers and URL-derived membership IDs do not require migration.

Prefer adopting existing host bind paths or explicitly named external volumes
when their ownership and backup model are suitable. Moving a Compose definition
does not require moving its data. If data is currently inside a container or a
path must change, use a validated destination and a stopped-writer final copy.
Do not assume Docker will adopt a container labeled for another Compose project.
Retain a restorable old definition and image while preventing the old deployer
from recreating these two services after ownership transfers.

The old stack may contain unrelated services. Stop/remove only the transferring
services; do not run its stack-wide `down`, remove its shared networks, or delete
volumes. Never run two writers against the same live configuration database.
For the observed deployment, adopt the three existing binds and use the new
default network plus monitoring network with preserved service aliases. No data
directory relocation, new downloads volume or helper migration is currently
justified. Reconfirm the old network's consumers before eventual retirement.

### Protect ordinary releases from interrupting playback

Change the normal release path from stack-wide `down` to an update that reconciles
services without stopping unchanged TorrServer/Jackett instances. Keep the
current simple release model, web/API `latest` publication, environment choice,
monitoring network and API health wait. Third-party services use pinned vendor
images, not new GitHub build-matrix entries. Preserve web `8092:80`; do not add a
proxy for media/search under the existing API-only Apache route.

### Fix client behavior separately

Union ownership records for the two configured normalized endpoint IDs, dedupe
them, and intersect only with the active endpoint's torrent list. Claim under
the endpoint used to save. Removal releases ownership under both configured IDs,
never removes a torrent from the server, and reports partial failure honestly.

Classify account errors by operation so a background read failure cannot claim
an unsaved edit. Retain safe retries, streak suppression, dirty values, boot
fallback and identity/revision guards. Diagnostics expose only operation category,
method/status and timing, never document contents or credentials.

For built-in file-dialog cancellation and discovery timeout, stop local requests
and timers without sending a hash-wide drop that can interrupt another reader.
Keep the explicit public `Torserver.drop` API working. Rely on verified server
reader disconnect/expiry for cleanup; confirm that actual startup flags permit
bounded cleanup. Do not substitute a blanket no-op wrapper or assume a local
viewer counter represents all devices.

### Tune memory first, then search overhead

Do not recreate the known dangerous multi-GiB workload just to obtain a baseline.
Use historical evidence plus bounded/isolated measurements. Verify supported
options against the exact installed version before applying them.

The existing MatriX.143 investigation proposes a **trial**, not a proven profile:

| Option | Historical baseline | Candidate / meaning |
| --- | --- | --- |
| `CacheSize` | `2147483648` | `536870912` bytes (512 MiB per distinct hash) |
| `PreloadCache` | `1` | Try cache-only reduction first; then `4` percent to restore approximately 20.48 MiB nominal preload |
| `ReaderReadAHead` | `95` | Retain initially; optional later `80` trial changes ahead/behind allocation, not total capacity |
| `ConnectionsLimit` | `25` | Retain initially; optional later `16` trial only if throughput remains adequate |
| `UseDisk` / `ResponsiveMode` | `false` / `true` | Retain initially |
| `TorrentDisconnectTimeout` | `30` | Retain pending real reader/expiry verification; polling can refresh lifetime |
| rate limits / upload | unlimited / enabled | Preserve initially; no blanket cap that prevents users choosing 4K |

Three distinct hashes at 512 MiB imply 1.5 GiB **nominal cache**, not a process
memory limit. Piece allocation, reader/in-flight state, Go heap, network buffers,
helpers and allocator overhead need measured headroom. Same-hash readers share
cache, so resolution or viewer count alone is not a memory-budget formula.

Choose a sustained budget from host capacity minus neighboring-service demand
and OS headroom. Only then evaluate a Compose-supported process memory boundary,
reservation/swap behavior and supported Go runtime options. A cgroup OOM is still
a playback failure; a cap alone is not the fix. Do not enable disk caching,
extra instances, aggressive GC, swap changes or CPU throttles without evidence.
Use controls enforced by the actual standalone Compose/Engine combination;
do not assume a Swarm-only resource declaration constrains these containers.

Jackett supports discovery/search rather than the steady media stream. Measure
concurrent searches, enabled-indexer fan-out, retries, FlareSolverr/browser work
and neighboring consumers separately. Keep all indexer configuration, API keys,
authentication/cookies, proxy configuration and blackhole paths. Choose only
version-supported search/timeouts/resource changes after measurement; do not
invent a generic concurrency environment variable or remove indexers to make a
benchmark pass. Record application auto-update behavior because a pinned image
may not contain the binary currently executing in an updated writable layer.

TorrServer settings saves are interrupting in the audited version: they replace
the full settings object and reset torrent/client state. Apply a candidate by
merging into a preserved full snapshot, during an idle window, and verify readback.
Never submit the table as a sparse settings replacement or assume file edits
hot-reload. Keep runtime cache/settings out of Git except sanitized profiles.

## Implementation steps

### Task 1: Finalize the production inventory and preservation contract

**Files:**
- Create: `docs/container-migration-inventory.md` (sanitized facts only)
- Modify: this plan

- [ ] Incorporate the Hermes report with observation times, evidence locations,
  exact image/runtime versions and unresolved facts. Recheck stale facts before
  cutover; keep secrets/private infrastructure evidence on the server.
- [ ] Record every service/deployer, persistent/writable-layer path, bind/volume,
  owner/mode, network/alias, published TCP/UDP mapping, health/monitoring check,
  proxy/VPN/helper and external consumer. Distinguish auth/config/database data
  from disposable cache and current streams.
- [ ] Produce an old-to-new mapping with the actual storage names and adoption
  or copy choice for each path. Include TorrServer settings/auth/saved torrents/
  trackers and Jackett server/indexer/API-key/cookie/cert/download state.
- [ ] Resolve runtime auto-updates and restorable version artifacts; an image
  digest alone is insufficient if the running app was updated after creation.
- [ ] Validate the inventory against selected read-only inspect/config metadata;
  identify maintenance-window and external-owner actions explicitly. Do not fill
  missing values with generic Docker examples.

### Task 2: Add the existing TorrServer service without tuning

**Files:**
- Modify: `devops/docker-compose.yaml`, `devops/.env.example`
- Modify: `.github/workflows/deploy-docker.yaml` (only new configuration inputs)

- [ ] Define TorrServer using the actual installed version/digest and verified
  command/env, auth flags, storage, restart policy, ports/protocols and network
  contracts. Preserve current application settings during transfer.
- [ ] Select existing bind/external-volume adoption or validated copied storage
  from Task 1; account for local development paths without silently creating
  empty production data. Keep sensitive state outside checkout/web output.
- [ ] Add only required environment inputs with harmless example placeholders;
  make production environment generation preserve/provide all required values.
- [ ] Define lightweight, image-supported liveness that does not start a stream,
  touch a torrent or refresh cache lifetime. Preserve required monitoring access.
- [ ] Render local/release Compose with nonsecret fixtures and verify service
  startup/auth/storage/port compatibility in an isolated rehearsal using copied
  synthetic data; verify missing/invalid inputs fail clearly. Keep build-block
  layout compatible with the existing deploy transformation. Rehearsal uses
  distinct explicit container names, ports and data copies: `-p` alone does not
  isolate a Compose file with fixed `container_name`. On ARM development hosts,
  use a compatible Linux/amd64 test host or explicit emulation for these pins.

### Task 3: Add the existing Jackett service without tuning

**Files:**
- Modify: `devops/docker-compose.yaml`, `devops/.env.example`
- Modify: `.github/workflows/deploy-docker.yaml` (only new configuration inputs)

- [ ] Define Jackett using its verified running application and image versions,
  UID/GID/TZ, command/env/update behavior, config/download mounts, permissions,
  ports, networks and DNS aliases; preserve proxy/helper dependencies.
- [ ] Preserve its current API key and complete private indexer/server state.
  Do not replace the configuration with an example or export secrets into GitHub
  logs. Preserve other applications' integrations as well as Lampa's settings.
- [ ] Keep a shared FlareSolverr/VPN in its existing stack unless the inventory
  proves it belongs exclusively with Jackett and needs to move; document any
  shared external network explicitly.
- [ ] Render Compose and rehearse with synthetic configuration, including
  ownership mismatch, unreachable helper and missing mount cases. Verify the
  target version can read copied state without an unplanned schema upgrade.
- [ ] Record configuration/API-key/indexer-count comparison checks that return
  pass/fail without printing private values; pass the Compose CI check.

### Task 4: Preserve live playback during ordinary web/API deployments

**Files:**
- Modify: `.github/workflows/deploy-docker.yaml`
- Modify: `.github/workflows/tests.yaml` only if existing checks need extending

- [ ] Replace normal stack-wide `down` with reconciliation that leaves unchanged
  third-party services running; retain pulling the intended images and updating
  web/API services. Do not force-recreate the whole project or remove orphans
  belonging to other owners.
- [ ] Preserve project/volume identity, default-branch/manual-only behavior,
  environment handling, external monitoring network and the API health wait.
- [ ] Ensure third-party digest pins survive release image rewriting and remain
  vendor pulls rather than locally built `:latest` images. Do not prune retained
  rollback images/artifacts before migration acceptance.
- [ ] Validate release shell syntax and Compose output; rehearse a web/API-only
  update with unchanged third-party container IDs/start times, then a deliberate
  service-specific update. Verify failed API startup still reports failure.
- [ ] Keep the release path simple: no new release-time Compose grep guards,
  media proxy, broad published-port rewrite or unrelated database binding change.

### Task 5: Write and rehearse configuration transfer and rollback

**Files:**
- Create: `docs/container-migration-runbook.md`
- Modify: `docs/container-migration-inventory.md`

- [ ] Write the precise, inventory-based cutover sequence and commands described
  below, with storage capacity/ownership checks, writer quiescence and a single
  deployment owner. Clearly label source project and destination project. For
  current TorrServer, account for `--dontkill`: temporarily disable its restart
  policy, invoke the supported `/shutdown` API during the idle window and verify
  exit before backing up; retain its original policy for rollback.
- [ ] Specify offline/private backups of full configuration, databases, mutable
  application artifacts and required secrets, including checksums and a restore
  rehearsal. Keep RAM cache and active connections classified as nonmigratable.
- [ ] Document current-path adoption versus stopped final copy, conflict handling
  for old container names/ports, and old automation retirement without stopping
  unrelated services or deleting volumes/shared networks.
- [ ] Specify post-start integrity/endpoint/credential/consumer checks, rollback
  before and after new writes, and a retention period for old artifacts. Restoring
  an old snapshot after new writes requires explicit reconciliation/data-loss
  accounting; do not silently discard new saved torrents or indexer edits.
- [ ] Validate all shell snippets and complete a synthetic restore/cutover/rollback
  rehearsal. Record actual outcomes, duration and limitations; writing the
  runbook is not evidence production configuration was migrated.

### Task 6: Separate account refresh/load/apply errors from failed saves

**Files:**
- Modify: `svtlv/account-sync.js`, `tests/account-sync.test.cjs`
- Modify: `tests/account-state.test.cjs` if account UI behavior changes

- [ ] Classify startup/account-load/read/apply/write failures at their producing
  paths; add concise English/Russian add-on messages. A failed background GET on
  an unchanged client must not display a claim that a save failed. Classify by
  caller intent as well as HTTP method: a failed read required to save dirty
  edits can still mean those edits could not be saved.
- [ ] Keep authentication expiry behavior, local dirty edits, storage-failure
  upload disablement, safe retries, failure-streak suppression, boot deadline,
  baseline/revision guards and account-switch/logout fencing intact.
- [ ] Add bounded local diagnostics for phase, method/status/category and elapsed
  time; exclude URLs containing credentials, document bodies, user/token IDs and
  private settings. Do not add new account-synced transient state.
- [ ] Add regressions for unchanged-client read failure, actual PUT failure,
  save-preflight read failure, apply/storage failure, boot deadline,
  recovery/repeated failures and stale responses across accounts. Use independent
  guest/signed-in clients, same-account clients and different accounts without
  assuming notification transport.
- [ ] Run account runtime tests and ES5 parsing. Keep any statement about the
  owner's precise production failure open until device evidence establishes it.

### Task 7: Share owned torrents across both configured links

**Files:**
- Modify: `svtlv/torrserver-ownership.js`, `tests/torrserver-ownership.test.cjs`
- Modify: `tests/torrserver-one-link.test.cjs` where its existing expectations change
- Modify: `backend/README.md`, `docs/design/settings-sync-backend-design.md`
- Modify: `tests/ownership-docs.test.cjs` only for changed documented contracts

- [ ] Factor the existing normalization/digest into reusable endpoint-ID handling;
  build a deduplicated set from both configured URLs, preserving effective-link
  fallback and existing IDs. No physical-server discovery or data migration.
- [ ] Read both membership sets through the existing API, union them, intersect
  with the active endpoint's live list, and fail closed on unavailable membership
  reads. Never contact the inactive TorrServer address or expose another user's
  torrents. Preserve guest-local equivalent behavior.
- [ ] Keep saving scoped to the endpoint used for that operation. Release this
  user's membership under both IDs on removal; use idempotent retries after
  partial failure, never report full success early and never physically delete
  the torrent. Dedupe identical normalized endpoints.
- [ ] Capture both URL identities plus account/selection/operation generations;
  invalidate pending work on either URL edit, account switch, logout or link
  change, including away-and-back changes. Retain local selector and shared
  credential-sync semantics.
- [ ] Add tests for shared/different servers, absent active-server torrent,
  duplicate hashes/URLs, empty/fallback URLs, auth/partial failures, retry and
  account/guest isolation/races. Preserve the existing test that public `drop`
  stays original. Run ownership/account/ES5 checks and update affected docs.

### Task 8: Make built-in discovery cancellation safe for other viewers

**Files:**
- Modify: `app.min.js` (only affected built-in lifecycle paths)
- Create: `tests/torrserver-playback.test.cjs`
- Modify: `.github/workflows/tests.yaml` to run the new behavioral tests

- [ ] Add characterization tests executing actual discovery/dialog/preload code:
  identify hash-wide drops on dialog close and discovery timeout, timer/request
  behavior and late responses after cancellation/restart.
- [ ] Replace these automatic destructive cancellations with local cleanup;
  leave explicit exported `Torserver.drop` and membership-only removal intact.
  Mark narrow bundle changes for upstream reapplication. Do not implement this
  by overriding every public drop with a no-op.
- [ ] End discovery intervals on terminal timeout and guard stale callbacks so
  they cannot reopen UI, issue repeated work or act on a replacement torrent.
  Fix duplicate status/preload loops only where characterization proves them;
  preserve necessary paused-reader keepalive behavior.
- [ ] Verify the installed server's reader lifetime, disconnect flags and expiry
  allow bounded cleanup without forced cross-client drops. If not, resolve that
  prerequisite with a separately tested supported mechanism before release;
  do not assume an in-tab reader count is authoritative across devices.
- [ ] Add success/error/repeated-open/late-response regressions, same-hash client
  A cancellation while B streams, different hashes, timeout and local player
  teardown. Run Node/ES5 checks; real two-device interruption/cleanup checks stay
  mandatory. Preserve the existing Timeline/timecode behavior.

### Task 9: Add repeatable bounded measurements and candidate profiles

**Files:**
- Create: `devops/measure-playback.sh`
- Create: `tests/playback-measurement.test.cjs`
- Create: `docs/parallel-playback-validation.md`
- Modify: `.github/workflows/tests.yaml` to run relevant new runtime checks

- [ ] Collect timestamped bounded cgroup/host CPU, current/peak memory, OOM
  counters, swap-in/out, reclaim, CPU/memory/I/O PSI, disk/network rates and
  neighboring-service health. Track container/cgroup generation so a restart
  cannot erase prior peaks/OOM evidence. Handle unavailable metrics explicitly.
- [ ] Include labeled viewer start/seek/stop events, actual measured bitrate,
  stream counts, client/player/codec/network route, startup/seek latency and
  buffering. Do not collect media identifiers/private logs or poll status/cache
  endpoints during cleanup measurements when those calls refresh lifetime.
- [ ] Define baseline/candidate snapshots, one-variable trial order, exact
  version/units and full-settings merge/readback/rollback steps. Treat 512 MiB
  then preload 4% as hypotheses pending production-version verification.
- [ ] Add fixture-based parsing/duration/cgroup-restart/missing-metric/failure
  tests; prove the collector performs no settings writes, stream requests or
  unbounded work. Run shell syntax checks and Node tests.
- [ ] Document the workload matrix, success/abort criteria and report template
  below, including single 4K and optional concurrent 4K. Do not load-test live
  production as part of implementing the collector.

### Task 10: Persist only validated performance settings and boundaries

**Files:**
- Modify: `devops/docker-compose.yaml`, `devops/.env.example`
- Modify: `.github/workflows/deploy-docker.yaml` if validated inputs change
- Modify: `docs/parallel-playback-validation.md`, `docs/container-migration-runbook.md`

- [ ] After external trial evidence is available, record baseline/candidate
  outcomes and choose the supported TorrServer cache/preload/cleanup settings
  that meet the target; document unsupported/high-bitrate combinations honestly.
- [ ] Calculate aggregate cache/overhead and host-neighbor headroom. Persist only
  measured Compose-compatible resource controls and any verified runtime knobs;
  test the boundary without calling an OOM/restart successful prevention.
- [ ] Evaluate Jackett/search/helper overhead separately. Persist only supported,
  measured timeout/concurrency/update/resource changes without losing indexers,
  cookies, API keys, proxy dependencies or external consumer functionality.
- [ ] Keep current user-selectable media qualities and direct-play capability;
  avoid forcing GST off on clients that need it. Preserve useful account sync,
  local active-link selection and both connection URLs.
- [ ] Add/update behavioral tests for any new apply/measurement code; otherwise
  render/test effective Compose settings and repeat the bounded trial after
  recreation. Document durable config sources, units, trade-offs and rollback;
  leave this task pending if runtime evidence is unavailable.

### Task 11: Verify repository acceptance and record operational gates

**Files:**
- Modify: this plan, `docs/parallel-playback-validation.md`

- [ ] Run `node --test tests/*.test.cjs` and
  `npx --yes acorn@8.14.0 --ecma5 --silent svtlv/*.js app.min.js`.
- [ ] Run `docker compose -f devops/docker-compose.yaml --env-file devops/.env.example config --quiet`
  and validate release output in CI/rehearsal; check modified deployment and
  measurement shell syntax. Run appropriate Go checks if backend code changed.
- [ ] Verify all backlog requirements map to implemented tests/manual cases;
  distinguish regressions fixed from incident hypotheses that remain unproven.
- [ ] Record restore rehearsal, unchanged-endpoint/credential verification,
  unchanged-service deployment rehearsal and real-device/performance results.
  Mark unavailable external evidence as pending, not passed.
- [ ] Require successful operational migration and stated capacity/cleanup checks
  before claiming the whole initiative complete or removing the performance item.

### Task 12: Finalize documentation and close verified backlog items

**Files:**
- Modify: `backend/README.md`, `AGENTS.md` if deployment guidance changes
- Modify: `docs/design/settings-sync-backend-design.md`
- Modify: `docs/container-migration-inventory.md`, `docs/container-migration-runbook.md`,
  `docs/parallel-playback-validation.md`
- Delete: each `docs/backlog/` item only with its verified closing change
- Move: this plan to `docs/plans/completed/` only after all required work/acceptance

- [ ] Document service ownership, upgrade procedure, persistent config/secret
  backups, ordinary deploy behavior, capacity limits and rollback retention.
- [ ] Update membership/error/lifecycle behavior and version-specific tuning
  guidance. Keep operational evidence sanitized and maintain links to private
  production records without copying raw logs or secrets.
- [ ] Validate links and command snippets and rerun checks affected by doc changes.
  Replace links to deleted backlog files with closing-commit references when
  archiving the completed plan.
- [ ] At the end of implementation, delete every resolved item file from
  `docs/backlog/` with `git rm` and verify no completed item remains. Include each
  deletion with its closing change; do not merely mark the item resolved in prose.
- [ ] Keep unresolved work visible and do not close the original device incident
  solely on a wording fix; retain any item still awaiting required verification.
- [ ] Move the plan only when repository and external acceptance are complete;
  never auto-commit or deploy as a side effect of plan creation.

## Post-completion: external execution and acceptance

These are operational actions outside repository editing. They require a planned
idle/maintenance window and the actual production inventory. Implementation can
prepare/rehearse them; it cannot infer their success from CI.

### Configuration migration sequence

1. Reconfirm live versions, storage, owners, networks/consumers and old deployment
   automation. Secure backups outside Git; verify a restore before touching old
   containers. Prestage pinned images and copied/synthetic rehearsal data.
2. Freeze deployments/config edits on the transferring services. At an agreed
   idle window, stop the old writers and take the final consistent backup/copy.
   TorrServer's current `TS_DONTKILL=1` ignores SIGTERM. Temporarily disable its
   `unless-stopped` restart policy before the versioned API's `GET /shutdown`,
   which closes the torrent client and BBolt database and exits. This GET is a
   mutating operational action, not a read-only health probe. Verify the process
   exited and did not restart; rehearse error/timeout handling instead of silently
   accepting a SIGKILL as a graceful backup boundary. Gracefully stop Jackett too.
   Preserve numeric ownership/modes and all databases/config/auth/indexer state;
   do not regard copying live database files as a consistent backup.
3. Prevent the old deployment definitions/jobs from recreating these services.
   Remove only their stopped containers when names/ports conflict. Retain the
   old definitions, images and private backups; preserve unrelated old services
   and any external/shared network. Never use `down -v`.
4. Start the new definitions against the adopted paths or verified copied data,
   with exactly one writer. Verify unchanged endpoint routing from LAN/tailnet,
   auth/API-key equality without disclosure, config/indexer/torrent-record
   integrity, helper connectivity and other consumers. Test harmless health
   first; any indexer/stream verification must be bounded and agreed.
5. Observe idle stability and record the migration result before any tuning.
   Runtime RAM caches and in-flight playback cannot be migrated; downtime is
   measured, not promised as zero. Roll back if integrity/consumer checks fail.
6. After acceptance, keep old data/images for the documented retention period.
   Confirm the old stack's next deployment cannot recreate the transferred
   services. Test an ordinary Lampa release without restarting them.

Rollback stops the new writers, captures any post-cutover changes, restores the
old definitions/version artifacts and either safely reuses compatible current
data or restores/reconciles the private backup. Restore prior ownership/network
contracts and verify endpoints/consumers. Do not run old/new writers together or
erase new writes to make rollback appear successful.

### Bounded playback and search trials

Required matrix: idle; one 1080p stream; two and three distinct 1080p torrents;
two/three readers of the same torrent; simultaneous preload; steady playback;
seek/pause/resume; one viewer stopping/closing/timing out while others continue;
all viewers stopping and cache cleanup; restart/reconnect; LAN/tailnet routes.
Include three concurrent Jackett searches during playback with a fixed indexer
set, distinguishing search latency/failure from streaming performance.

Also test single-viewer 4K with actual player/codec and bitrate recorded. Offer
mixed/three-4K trials only if prior stages retain headroom and the owner wants
them; inability to sustain that optional workload does not justify blocking 4K.
Resolution alone is not a bandwidth specification: record sustained/peak media
bitrates and actual ingress/egress capacity for every claimed result.

Proposed trial protocol: repeat startup/seek/cancellation cases three times per
candidate, sustain the required three-viewer stage for at least 60 minutes, then
observe cleanup for at least 10 minutes after every reader/poller stops. Use an
isolated environment first. Do not deliberately replay the unsafe original
three-torrent 2 GiB-per-hash profile on the production host.

Before a live trial, agree numeric available-memory/PSI/swap/latency stop thresholds
using the inventory and a safe baseline. Proposed quality gates: no OOM/restarts,
no cross-viewer interruption, no sustained reclaim/swap collapse, all required
neighbor services healthy, no avoidable buffering on adequately seeded content,
and startup/seek latency no worse than 20% above the safe one-viewer reference.
Record absolute latency and interruptions as well as ratios. Host headroom and
process limits must be fixed before trials, not chosen after viewing results.
Abort immediately on an OOM, failed neighbor health, severe sustained pressure,
or playback regression; revert preserved full settings during an idle window.

Validate bounded cleanup against the actual disconnect configuration and measured
reader lifetime; lifetime counters/saved torrent records are not active caches.
If process memory remains elevated, distinguish retained Go heap from live cache
payload and allocator/page-cache effects before calling it a leak or a pass.

### Actual device warning verification

Reproduce the owner's arrangement: one anonymous device and one signed-in device,
with simultaneous playback. Capture the signed-in client's operation category,
request result and timing alongside backend health/resource metrics. Verify
refresh failures are described accurately and actual unsaved changes remain
recoverable. Supplement with same-account/different-account and guest-pair tests.
Check actual app/plugin revisions and platform/player behavior; do not infer
cross-device notification delivery because two clients show similar local text.

## References

- Existing backlog records contain the dated MatriX.143 source audit and November
  6–7 production observations; revalidate their assumptions before changing runtime
  settings.
- [TorrServer official repository](https://github.com/YouROK/TorrServer): current
  container guidance is version-sensitive; do not substitute latest defaults for
  the installed historical build.
- [LinuxServer Jackett image documentation](https://docs.linuxserver.io/images/docker-jackett/):
  image-specific persistence/UID/GID/update behavior, applicable only if production
  actually uses this image family.
- [Docker Compose service reference](https://docs.docker.com/reference/compose-file/services/):
  validate resource controls against the real server Compose/Engine versions.
- Versioned MatriX.143 [signal handling](https://github.com/YouROK/TorrServer/blob/5c812ec1abe4c8e0acee29d820f78205a8f0e7b7/server/cmd/preconfig_pos.go),
  [graceful shutdown API](https://github.com/YouROK/TorrServer/blob/5c812ec1abe4c8e0acee29d820f78205a8f0e7b7/server/web/api/shutdown.go)
  and [database-closing shutdown](https://github.com/YouROK/TorrServer/blob/5c812ec1abe4c8e0acee29d820f78205a8f0e7b7/server/torr/apihelper.go):
  checked during planning; preserve the distinction between process signals and
  idle-reader expiry.
