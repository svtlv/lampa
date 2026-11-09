# Manual TorrServer and Jackett handover

This runbook is for the owner to use after repository implementation, at a chosen
release window. Writing and validating it does not stop containers, deploy, back
up data, change settings or verify production. None of those actions is required
to complete the implementation plan.

Use the [service and data inventory](container-migration-inventory.md) for image
pins, runtime settings and the dated production snapshot. The delivered
[Compose definition](../devops/docker-compose.yaml) and manual
[deployment workflow](../.github/workflows/deploy-docker.yaml) are the destination.
Both applications upgrade during adoption: TorrServer MatriX.143 to MatriX.150,
and Jackett v0.24.2475 to the v0.24.3030 application in image v0.24.3030-ls30.
Review the inventory's matching target-source and release notes before cutover.
File preservation alone does not establish upgrade or downgrade compatibility.

## Cutover order

```text
Preserve rollback references and private comparison data
                         |
Stop old writers -> finalize consistent pre-upgrade backup
                         |
Free old names/ports -> deploy destination stack
                         |
Verify versions, saved data, credentials and consumers
                         |
Retire old deployment entry point and obsolete sources
                         |
Keep all three active bind directories
```

**Note:** Only the deployment definitions change ownership. The new containers
open the existing bind directories after the old writers have stopped.

### 1. Prepare the release and recovery material

Use a maintenance window: shutdown, upgrade and the normal full-stack deployment
interrupt playback and searches. Inform other consumers of the expected outage.
Keep the old Compose definition at
`/opt/svtlvtv/torrserver/docker-compose.yml`, its environment/options and historical
image references available in a private recovery location. Keep the prior Lampa
release reference too. Do not rely on locally cached images surviving pruning.

Prepare backup storage outside the three live binds and any obsolete source tree.
Record a private before-upgrade comparison of the full TorrServer settings and
saved-torrent records, Jackett server/indexer configuration and indexer inventory,
API/admin credentials, cookies and DataProtection state. Include both configured
TorrServer URLs, shared credentials, player/link selection and the stored Torznab
destination/key. Do not put values, media identifiers, exports or private logs in
Git or CI output. Counts alone cannot prove credentials or records survived.

Account for writable-layer files before deleting containers: TorrServer logs at
`/opt/ts/log` are outside the binds, and any additional state was not established
by the snapshot. Preserve anything needed for recovery or diagnosis separately.
The existing Jackett `.bak` files are not a verified full backup.

The old definition's source repository/redeployer and additional consumers were
not established. During the operational handover, identify and suspend anything
that could recreate the old writers, and record consumers to check afterward.
These are later operational checks, not missing implementation inputs.

### 2. Stop old writers and secure the pre-upgrade backup

The old Compose project is `torrserver`. Stop its TorrServer and Jackett writers
before the destination project `svtlvtv` starts either service. Follow the signal
caveat below for TorrServer. Confirm both are stopped and cannot restart, then
take a consistent offline backup of the complete three bind directories. Preserve
numeric ownership, modes and any other recovery-relevant metadata; verify the
backup can be read/restored in isolation before allowing the new binaries to write.
This backup is recovery material, not a relocation or import into new live paths.

Retain the stopped containers until needed writable-layer files are secured.
Remove the old container objects as needed to free the fixed names `torrserver`
and `jackett` and host TCP ports 8090/9117. Stopping alone does not free container
names. Keep the old definition and recovery material until verification succeeds.
Do not remove bind data, shared networks, unrelated services or Lampa's database
volume. Never run old and new writers against the same writable directory.

### 3. Deploy the destination stack

Release/review the completed changes, then run the existing manual deployment
workflow from the default branch with the intended Test or Production environment.
Development is rejected before build/shutdown. Keep the existing secrets and
`DEPLOY_DIR=/home/deploy/svtlvtv` contract; its basename preserves the `svtlvtv`
project and `svtlvtv_lampa_db_data` volume identity. Do not override project identity
or start a second independent stack as a migration shortcut.

The workflow installs the release definition at
`/home/deploy/svtlvtv/docker-compose.yaml`, retains the pinned vendor images and
runs full-stack pull/down/up. It reuses the existing paths directly; no data
copying, import, credential regeneration or settings replacement is needed.
Retain `svtlv_monitoring_external`, service aliases and Lampa web `8092:80` on the
existing host interfaces. The Apache proxy remains API-only.

The workflow requires API, TorrServer and Jackett to be running and healthy
together within a shared three-minute wait. Startup failure reports selected
state/health/exit/OOM/restart fields and bounded API logs. Vendor configuration,
health-probe output and vendor logs are excluded from that report. A failed wait
does not automatically roll back; inspect privately and use the recovery procedure
below if necessary. A failed image pull occurs before normal stack shutdown.

### 4. Verify before retiring old sources

Compare privately against the pre-upgrade record. Do not treat an HTTP health
response as proof that configuration, credentials or consumer access survived.

| Check | Required comparison |
| --- | --- |
| Image and runtime | Selected digest pins, effective application versions, TorrServer command/path flags/root UID:GID, Jackett `--NoUpdates` beneath root s6 with application UID:GID `1000:1000` |
| Storage | Exactly the three existing bind pairs below; ownership and readable saved configuration/databases; no replacement empty directory or generated defaults |
| TorrServer data | Full settings and saved-torrent records retained; no 512 MiB/4% candidate applied during migration; both client URLs and shared credentials preserved |
| Jackett data | Complete indexer/server settings, API/admin credentials, cookies and DataProtection state retained; compare actual records, not only the snapshot's counts |
| Internal search | DNS alias `jackett`, port 9117 and `jackett:9117/api/v2.0/indexers/all/results/torznab/` remain usable from TorrServer with the retained stored key |
| Client access | Existing LAN/tailnet endpoints, both TorrServer links, local link/player selection and known additional consumers work with their retained credentials |
| Readiness | API, TorrServer and Jackett healthy; privately inspect any unexpected restart/OOM or permission/configuration failure |

For a limited state-only check on the destination host, the following snippet is
read-only. It neither requests torrent state nor displays private configuration:

```bash
for container in svtlvtv_lampa_api torrserver jackett; do
  docker inspect --format 'name={{.Name}} state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' "$container"
done
```

TorrServer's container-local `GET /echo` checks version-only HTTP liveness;
Jackett's `GET /health` checks anonymous HTTP readiness. Neither checks a torrent,
cache, stream or indexer search. Neither proves Torznab or upstream credentials
work. Docker health status alone does not restart an unhealthy process.
Use deliberate consumer checks during this later acceptance window. Keep API keys
out of command lines, shared logs and shell history.

### 5. Retire obsolete deployment sources after successful verification

Retire the old redeployment entry point so it cannot recreate conflicting writers.
The old Compose definition and confirmed obsolete deployment-only files under
`/opt` can then be removed from their former live location. Retain their recovery
copies for the chosen rollback window. Review individual paths and symlink targets
before cleanup; no recursive deletion of `/opt/svtlvtv` or the Jackett parent tree
is part of this handover.

| Path | Treatment after cutover |
| --- | --- |
| `/opt/svtlvtv/torrserver/docker-compose.yml` | Obsolete live deployment definition after verification; retain private recovery copy |
| Other old source/automation paths | Remove/retire only after identifying them and confirming they contain no live data; snapshot did not identify them |
| `/var/lib/torrserver/config` → `/opt/ts/config` | Keep complete active configuration/database bind |
| `/var/lib/torrserver/cache` → `/opt/ts/torrents` | Keep active torrent/cache bind, even if empty |
| `/opt/svtlvtv/jackett/config` → `/config` | Keep complete active Jackett bind, including credentials; it is not obsolete source |
| `/home/deploy/svtlvtv/docker-compose.yaml` | Keep active destination definition and its private environment file |

## TorrServer signal handling and graceful shutdown

The recorded MatriX.143 deployment and selected MatriX.150 use `TS_DONTKILL=1`,
which adds `--dontkill`. The target's
[signal handler](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/cmd/preconfig_pos.go)
ignores SIGTERM with this flag. Ordinary Compose down/stop may reach Docker's
forced-kill deadline. Increasing a stop timeout does not turn an ignored signal
into graceful shutdown. The flag does not control torrent idle expiry.

For an intentional graceful manual stop, first prevent the old container's
`unless-stopped` restart policy and any old automation from restarting it, then
use the supported mutating `GET /shutdown` on that TorrServer instance with any
required existing authentication. Do not place credentials in a public URL/log.
The [API handler](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/web/api/shutdown.go)
initiates shutdown asynchronously; an HTTP success is not proof the process has
exited. Its [shutdown routine](https://github.com/YouROK/TorrServer/blob/MatriX.150/server/torr/apihelper.go)
disconnects the torrent client, closes the database and exits. Confirm actual
container exit and that it remains stopped before backup or starting another
writer. If the API fails, investigate privately; do not assume a forced kill
provided a clean database close.

These are manual instructions only. `/shutdown` must never be used as a health
probe. The repository supplies no host shutdown, takeover or migration helper and
does not invoke this API during deployment. Normal full-stack deployments retain
their existing lifecycle and signal behavior.

## Manual rollback after an upgrade

On failed verification, keep the obsolete sources and pause further changes.
Stop the new writers and prevent automatic restarts before restoring anything.
Preserve a separate consistent copy of post-upgrade state and record any new
saved records or credential/configuration changes that need reconciliation.

Choose data known compatible with the intended old versions, or restore the full
pre-upgrade backup while both versions are stopped. Do not point the old binaries
at files rewritten by the newer releases unless compatibility has been established.
Do not overlay individual old files into a partially upgraded database/configuration
or silently discard post-upgrade writes. If compatibility or reconciliation is
uncertain, keep the service stopped until a safe recovery is chosen.

Restore original ownership/modes and the complete matching configuration/database
set, including Jackett cookies and DataProtection material. Use retained old
definitions, environment and historical image references from the inventory.
Free the new container objects' fixed names/ports before starting old containers;
restore the old intended restart policy and connectivity. Avoid concurrent
writers throughout recovery and recheck saved data, credentials and consumers.

The deployment workflow has no rollback/image-tag switch. A later durable release
rollback uses a reviewed revert and redeploy; that alone does not downgrade data
safely. Do not dispatch the unchanged new definition over a manually restored old
stack. Keep Lampa database volumes, other services and shared networks intact.

## Later deployments and live acceptance

Every normal deployment pulls/down/ups the full stack, including both vendor
services even when unchanged. Plan for playback/search interruptions and the
TorrServer signal caveat on each deployment. Verify a later normal redeployment
preserves saved data, settings and credentials and reports failed startup correctly.

If rehearsing separately, use explicit isolated container names, ports, networks
and synthetic bind paths. A different Compose project name alone cannot isolate
the fixed `container_name` values. Use compatible image architecture or explicit
emulation; never rehearse against the three production data binds.

No tuning change or capacity claim follows from migration readiness. Keep the
existing live settings, unrestricted 4K selection and all indexers. Resource trials,
viewer-isolation checks and the unreproduced account-warning incident remain later
live acceptance work described in the plan's final handover. The collector and
detailed tuning procedure are separate implementation tasks; this runbook records
no trial result or successful production cutover.
