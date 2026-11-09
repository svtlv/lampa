# TorrServer and Jackett service and data inventory

This is the implementation contract for adding the existing services to Lampa's
Compose stack. Production facts below are the November 8, 2026, 09:49–09:55:51 UTC
read-only snapshot recorded in the implementation plan. Public release and registry
metadata were rechecked on November 9, 2026. No production access, deployment,
configuration change or playback measurement was performed for this document.

## Image selection

### Historical installed images

These are rollback references, not targets for the new service definitions.

| Service | Recorded application/image version | Historical installed image |
| --- | --- | --- |
| TorrServer | MatriX.143, Linux/amd64 | `ghcr.io/yourok/torrserver@sha256:9a6b95f5744af2fcff55c505891c737f22dd6e1d3d53269fc2268ef3382507d9` |
| Jackett | Application v0.24.2475, image v0.24.2475-ls9, runtime 9.0.19, Linux/amd64 | `lscr.io/linuxserver/jackett@sha256:341ace61a953dd404892abd319ac6c871e39189c8e0a9cf618d03666a7620fa1` |

An old image reference alone is insufficient for rollback: newer applications may
rewrite persistent state. Later rollback requires compatible data or a reconciled
pre-upgrade backup, as described in the [manual handover runbook](container-migration-runbook.md#manual-rollback-after-an-upgrade).

### Selected stable container targets

| Service | Selected release | Published (UTC) | Release-tagged image-index pin |
| --- | --- | --- | --- |
| TorrServer | MatriX.150 | 2026-11-06 17:56:32 | `ghcr.io/yourok/torrserver:MatriX.150@sha256:2d02152b804946848f032dcca94fa0f096c8840cff3d37e1ba5400c30f70e16b` |
| Jackett | Application v0.24.3030, LinuxServer v0.24.3030-ls30 | 2026-11-08 06:45:20 (image) | `lscr.io/linuxserver/jackett:v0.24.3030-ls30@sha256:3af37ff2ca5f14da5529b9e2018e384735daf1bf08b99350e1211be863eeae20` |

The official latest-release APIs returned `draft=false` and `prerelease=false`
for [TorrServer MatriX.150](https://github.com/YouROK/TorrServer/releases/tag/MatriX.150)
and [LinuxServer v0.24.3030-ls30](https://github.com/linuxserver/docker-jackett/releases/tag/v0.24.3030-ls30).
Jackett's separate application release has advanced to
[v0.24.3036](https://github.com/Jackett/Jackett/releases/tag/v0.24.3036), published
November 9 at 05:49:18 UTC. It does not have a newer published LinuxServer release
at this check. Select the published stable container above; do not replace its
application in place or invent a corresponding image tag.

Both selected tags returned OCI image indexes. Each registry's
`Docker-Content-Digest` matched the SHA-256 calculated from the raw index response
and the pin above. Both include `linux/amd64` and `linux/arm64`; TorrServer also
includes `linux/arm/v7`. Attestation entries with an `unknown` platform are not
runtime platforms. LinuxServer's moving `latest` tag resolved to the same index as
v0.24.3030-ls30 at this check, but deployment must use the release/digest pin.

Public verification endpoints (read-only; no production credentials):

| Purpose | Endpoint |
| --- | --- |
| TorrServer latest stable release | [GitHub release API](https://api.github.com/repos/YouROK/TorrServer/releases/latest) |
| Jackett latest application release | [GitHub release API](https://api.github.com/repos/Jackett/Jackett/releases/latest) |
| LinuxServer latest image release | [GitHub release API](https://api.github.com/repos/linuxserver/docker-jackett/releases/latest) |
| TorrServer image index | [Tagged registry manifest](https://ghcr.io/v2/yourok/torrserver/manifests/MatriX.150) |
| Jackett image index | [Tagged registry manifest](https://lscr.io/v2/linuxserver/jackett/manifests/v0.24.3030-ls30) |

Registry requests used the OCI/Docker index Accept headers and the registry's
anonymous bearer-token challenge. Tokens are temporary transport details and are
not stored in Git. Release checks and index inspection do not pull or run images.

## Deployment and network identity

| Contract | Recorded old deployment | Destination contract |
| --- | --- | --- |
| Compose project | `torrserver` | `svtlvtv` |
| Live Compose definition | `/opt/svtlvtv/torrserver/docker-compose.yml` | `/home/deploy/svtlvtv/docker-compose.yaml` |
| Repository definition | External old source not established | [devops/docker-compose.yaml](../devops/docker-compose.yaml) |
| Service/container names | `torrserver`, `jackett` | Preserve those names |
| Restart policy | `unless-stopped` for both | Preserve |
| Project default network | `torrserver_default` | Destination default network (`svtlvtv_default`) |
| Shared monitoring network | `svtlv_monitoring_external` | Preserve existing external network |
| Service aliases | `torrserver`, `jackett` | Preserve on destination default and monitoring networks |
| Published ports | `8090:8090/tcp`, `9117:9117/tcp`, existing IPv4/IPv6 host interfaces | Preserve; no new UDP publication |

Keep both configured TorrServer client URLs and shared credentials. The active
link/player choice stays device-local. Keep Lampa web's `8092:80` publication and
its API-only Apache proxy; add no media/search proxy, FlareSolverr or VPN service.
The initial old-project takeover is manual. Follow the [runbook's cutover order](container-migration-runbook.md#cutover-order):
stop old writers, secure the consistent backup, free names/ports, deploy, verify,
then retire obsolete sources. Normal later deployments retain the full-stack
pull/down/up lifecycle and may interrupt playback and searches, even when the
vendor service configuration is unchanged.

## Persistent data: exactly three existing binds

| Host source | Container destination | Recorded owner/mode | Retained contents |
| --- | --- | --- | --- |
| `/var/lib/torrserver/config` | `/opt/ts/config` | `0:0`, directory `0755` | Complete configuration, `settings.json`, BBolt `config.db`, search state `rutor.ls` |
| `/var/lib/torrserver/cache` | `/opt/ts/torrents` | `0:0`, directory `0755` | Existing torrent/cache path; empty at snapshot with RAM cache enabled |
| `/opt/svtlvtv/jackett/config` | `/config` | `1000:1000`, directory `0755` | Complete server/indexer configuration, API/admin credentials, cookies and DataProtection state |

There were no named or anonymous volumes for these two services. Reuse these
three binds directly. Do not copy, relocate, regenerate or selectively reconstruct
their contents from this document. Jackett had 24 indexer JSON files and 20 `.bak`
files; those `.bak` files are not a verified complete backup.

`/opt/svtlvtv/jackett/config` is active persistent data, even though its path is
under `/opt`. It must survive any later removal of obsolete deployment sources.
Keep both `/var/lib/torrserver` binds too. Logs at `/opt/ts/log` are in TorrServer's
writable container layer, outside the three recorded binds.

Before allowing upgraded binaries to write, take a consistent offline backup of
the complete binds, retaining ownership/modes and configuration/database/credential
state. Account separately for recovery-relevant writable-layer files before old
containers are removed. Verify recovery material in isolation. Backups are not a
live-data relocation. The [cleanup path table](container-migration-runbook.md#5-retire-obsolete-deployment-sources-after-successful-verification)
distinguishes removable deployment definitions from retained live data; it does
not authorize deleting the Jackett parent tree under `/opt`.

## TorrServer runtime contract

The recorded effective command is:

```text
torrserver --path /opt/ts/config --logpath /opt/ts/log --port 8090 --torrentsdir /opt/ts/torrents --dontkill
```

| Setting | Recorded value / preservation rule |
| --- | --- |
| Process UID:GID | `0:0` |
| Path environment | `TS_CONF_PATH=/opt/ts/config`, `TS_LOG_PATH=/opt/ts/log`, `TS_TORR_DIR=/opt/ts/torrents`, `TS_PORT=8090` |
| Signal behavior | `TS_DONTKILL=1` adds `--dontkill`; retain |
| Go runtime | `GODEBUG=madvdontneed=1`; retain |
| HTTP auth | Enabling environment absent; `accs.db` and `trackers.txt` absent; introduce no new auth requirement |
| Existing client credentials | Preserve without publishing their values |

The target's [entrypoint](https://github.com/YouROK/TorrServer/blob/MatriX.150/docker-entrypoint.sh)
and [Dockerfile](https://github.com/YouROK/TorrServer/blob/MatriX.150/Dockerfile)
retain these path variables and command flags. Its
[signal handler](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/cmd/preconfig_pos.go)
still ignores termination signals with `--dontkill`. A normal container stop may
therefore reach Docker's forced-kill deadline. This is a handover caveat, not a
reason to change the preserved setting or automate shutdown in this task.
The [manual signal/shutdown instructions](container-migration-runbook.md#torrserver-signal-handling-and-graceful-shutdown)
cover preventing automatic restart, using the mutating `/shutdown` API and
confirming process exit before backup or another writer. The API is never a
health probe or a deployment hook.

Preserve the entire saved settings object. Recorded nonsecret values are:

| Setting | Baseline |
| --- | --- |
| `CacheSize` | `2147483648` bytes per distinct torrent hash |
| `PreloadCache` / `ReaderReadAHead` | `1` / `95` percent |
| `ConnectionsLimit` | `25` |
| `UseDisk` / `ResponsiveMode` | `false` / `true` |
| `TorrentDisconnectTimeout` | `30` seconds |
| Download/upload rates; upload | Unlimited; enabled (`DisableUpload=false`) |
| `TrackTimecode` | `false` |
| `StoreSettingsInJson` / `StoreViewedInJson` | `true` / `false` |

These are inventory values, not tuning recommendations. Initial service adoption
must not apply the later 512 MiB/4% candidates or impose an unmeasured resource cap.

## Jackett runtime and internal Torznab contract

The recorded application command is `/app/Jackett/jackett --NoUpdates`, running as
`1000:1000` beneath a root s6 supervisor. Preserve the supervisor model instead of
forcing the entire container to a nonroot UID.

| Environment / persisted field | Recorded value |
| --- | --- |
| `PUID` / `PGID` | `1000` / `1000` |
| `TZ` | `Asia/Jerusalem` |
| `XDG_DATA_HOME` / `XDG_CONFIG_HOME` | `/config` / `/config` |
| `TMPDIR` | `/run/jackett-temp` |
| `AUTO_UPDATE` | Absent; preserve effective `--NoUpdates` behavior |
| `UpdateDisabled` | `false` in persisted settings; do not infer effective auto-update from this alone |
| `Port` / `LocalBindAddress` | `9117` / `127.0.0.1` |
| `AllowExternal` / `AllowCORS` | `true` / `false` |
| `CacheEnabled` / `CacheTtl` / `CacheMaxResultsPerIndexer` | `true` / `2100` seconds / `1000` |
| Blackhole / base path / base URL overrides | Null |

The selected image's [service launcher](https://github.com/linuxserver/docker-jackett/blob/v0.24.3030-ls30/root/etc/s6-overlay/s6-rc.d/svc-jackett/run)
uses `--NoUpdates` unless `AUTO_UPDATE=true`. Its
[Dockerfile](https://github.com/linuxserver/docker-jackett/blob/v0.24.3030-ls30/Dockerfile)
retains the `/config` and temporary-directory environment. The matching
[application configuration model](https://github.com/Jackett/Jackett/blob/v0.24.3030/src/Jackett.Common/Models/Config/ServerConfig.cs)
retains the recorded fields and uses a wildcard listen address when
`AllowExternal=true`, despite the saved loopback `LocalBindAddress`.

TorrServer's existing Torznab destination is
`jackett:9117/api/v2.0/indexers/all/results/torznab/`. Its stored API key matches
Jackett's stored key. Preserve alias `jackett`, port, route and key by retaining
the complete configurations and shared networks. Do not put the key, credentials,
cookies, indexer JSON or private comparison logs in Git. No configured proxy or
FlareSolverr endpoint was found; add none. No downloads mount is needed.

The [TorrServer release notes](https://github.com/YouROK/TorrServer/releases/tag/MatriX.150)
describe web/PWA and HEVC HDR muxing fixes. The
[selected Jackett image notes](https://github.com/linuxserver/docker-jackett/releases/tag/v0.24.3030-ls30)
include indexer API/cookie changes. Preserving files is not proof that every
indexer remains functional after upgrading from v0.24.2475. Saved-data,
credential and consumer comparisons belong to later live acceptance.

### Jackett liveness and readiness

The Compose healthcheck makes a bounded, container-local `GET /health` with curl,
which the image's [Alpine base](https://github.com/linuxserver/docker-baseimage-alpine/blob/3.24/Dockerfile)
supplies. The matching [health controller](https://github.com/Jackett/Jackett/blob/v0.24.3030/src/Jackett.Server/Controllers/HealthcheckController.cs)
allows anonymous GET/HEAD and returns a constant status response. It does not
authenticate, read private configuration, search indexers or invoke Torznab.
The recorded null base path and port 9117 support the exact local URL in Compose.
No API key, admin password or new environment variable is required.

The probe allows three seconds per request, with a five-second Docker timeout,
a 30-second startup grace period and five retries at 30-second intervals. A
connection refusal, timeout or HTTP error fails the probe. Slow initialization,
unreadable configuration, permission errors or an application crash can leave it
starting or unhealthy. A future change to the stored port/base path would also
require updating this probe. Keep private configuration and credentials out of
failure reports. Docker health status alone does not restart an unhealthy process;
the preserved `unless-stopped` policy handles process exit.

Healthy means the HTTP application is responding. It does not establish working
indexer credentials, upstream availability, saved-data preservation or TorrServer
Torznab connectivity. Those checks remain in the [later manual verification](container-migration-runbook.md#4-verify-before-retiring-old-sources).
The release workflow now waits up to three minutes for API, TorrServer and
Jackett to be running and healthy together. Failed startup/readiness reports
selected container state fields and bounded API logs without vendor logs or
private configuration; it does not automatically roll back.

## Known unknowns and later operational context

| Item not established by the snapshot | Meaning for the later handover |
| --- | --- |
| Old definition's source repository/redeployer | Retire the old deployment entry point only during the manual cutover |
| Additional external consumers | Later verify existing LAN/tailnet endpoints and dependent consumers |
| Verified full backup and residual writable-layer files | Account for these before the first upgrade; the listed `.bak` files do not prove recovery |
| New-version state downgrade compatibility | Do not assume old binaries can reopen upgraded databases/configuration |
| Actual playback capacity, WAN/tailnet capacity and initiating OOM request | Remain unmeasured/unproven; later use the delivered collector and acceptance procedure |

Neither service had explicit CPU/memory/swap/PID limits or Docker healthchecks
at the snapshot. Both used `json-file` logging without explicit container rotation.
The repository definitions now add non-streaming healthchecks and preserve the
existing live settings without unmeasured resource caps. The delivered
[validation procedure](parallel-playback-validation.md) documents staged
unverified measurement candidates. The November 7 global OOM proves
TorrServer was killed, not that a leak or initiating request was identified.

These unknowns do not block repository implementation or request owner action
during it. Shutdown, backup, deployment, cleanup and live verification belong
exclusively to the [manual runbook](container-migration-runbook.md) and the
[completed plan's post-implementation handover](plans/completed/20261108-parallel-playback-and-container-migration.md#post-implementation-handover-all-owner-operated-actions). This
inventory claims neither successful migration nor measured three-viewer capacity.

Repository operational artifacts remain under the existing `docs/`, `devops/`
and `tests/` directories, excluded from the public web image by
[.dockerignore](../.dockerignore). The service definitions follow the image/build
layout contract in [devops/docker-compose.yaml](../devops/docker-compose.yaml)
and the existing manual [deployment workflow](../.github/workflows/deploy-docker.yaml).
