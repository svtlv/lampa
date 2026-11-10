# Lampa

Lampa is a free media catalog and player interface designed for televisions,
set-top boxes, phones, and desktop devices. It uses public sources to display
information about films, television series, new releases, and popular titles.
The application does not operate its own media-distribution servers.

> [!IMPORTANT]
> This repository contains the ready-to-run Lampa distribution, not its original
> source project. The source code and build system are maintained separately in
> [yumata/lampa-source](https://github.com/yumata/lampa-source).

## Supported platforms

- LG webOS
- Samsung Tizen
- MSX
- Android
- macOS
- Windows

The distribution consists entirely of static files and can also be served by a
regular web server for use in a compatible browser.

## Repository contents

| Path | Purpose |
| --- | --- |
| `index.html` | Application entry point and script loader |
| `app.min.js` | Complete prebuilt application bundle |
| `css/app.css` | Compiled application styles |
| `lang/` | Runtime translation files |
| `msx/start.json` | MSX application descriptor |
| `vender/` | Browser libraries loaded by `index.html` |
| `svtlv/` | Fork-only ES5 Account sign-in and TorrServer membership add-ons, plus the storage-scope allowlist |
| `Dockerfile` | Apache-based production image |
| `devops/docker-compose.yaml` | Five-service stack: local web/API builds, PostgreSQL, and pinned TorrServer/Jackett images |
| `devops/.env.example` | Template for the local `devops/.env` (gitignored) |
| `.github/workflows/tests.yaml` | Backend lint, tests and race, frontend Node checks and ES5 parsing, and a Compose config check on PRs and pushes to `svtlvtv` |
| `.github/workflows/deploy-docker.yaml` | Manual Svtlv deployment workflow |
| `backend/` | `lampa-api`, a fork-only Go service that stores user data in PostgreSQL; see [`backend/README.md`](backend/README.md) |
| `docs/` | Designs, completed implementation plans and optional playback measurement reference |

Despite its name, `app.min.js` is readable compiled output. The web application
has no package manager or build command. Fork-only add-ons and the two-link
TorrServer configuration have Node runtime checks and an ES5 syntax gate. Changes
to the application bundle or compiled CSS are made directly; browser and TV
verification remains manual. The test command is in [`backend/README.md`](backend/README.md).
The Go module under `backend/` is the exception: it has its own `Makefile`, tests
and linter, documented in [`backend/README.md`](backend/README.md).

## Run locally

### Static web server

Any static HTTP server can serve the repository root. For example, with Python:

```bash
python -m http.server 8080
```

Then open <http://localhost:8080>. Using an HTTP server is recommended instead of
opening `index.html` through a `file://` URL because the application loads scripts,
translations, and other resources dynamically.

### Docker

The Docker build requires the public domain or IP address that MSX will use. Pass
the host without a protocol and provide the protocol separately:

```bash
docker build \
  --build-arg domain=lampa.example.com \
  --build-arg prefix=https:// \
  -t lampa-web:local .

docker run --rm \
  --name lampa-web \
  -p 8092:80 \
  lampa-web:local
```

Open <http://localhost:8092>. During the image build, the `domain` and `prefix`
values replace the `{domain}` and `{PREFIX}` placeholders in `msx/start.json`.

### Docker Compose

`devops/docker-compose.yaml` defines five services: `lampa-web` (the Apache
image), `lampa-db` (PostgreSQL), `lampa-api` (the Go persistence service from
`backend/`), `torrserver` and `jackett`. The vendor images are pinned by release
tag in the Compose file, which is the configuration source of truth.
Compose builds `lampa-web:dev` and `lampa-api:dev` locally and reads its
values from `devops/.env`, which is gitignored; `devops/.env.example` is the
template. Compose interpolates every service even when only one is started, so the
secrets must be set even for a web-only run; the placeholders from the template
are enough for that. The file also attaches web/API and both vendor services to the
external `svtlv_monitoring_external` network, which must exist:

```bash
cd devops
cp .env.example .env                               # replace the placeholder secrets
docker network create svtlv_monitoring_external    # once
docker compose -p lampa up -d --build lampa-web lampa-api  # includes their DB dependency
```

Use `-p lampa` so a local stack does not share Svtlv's `devops` project.
Use the same project option on later Compose commands. Project names do not
isolate this file's fixed container names, published ports or absolute bind paths.
A full-stack `up` also starts TorrServer and Jackett against
`/home/deploy/svtlvtv/torrserver/config`, `/home/deploy/svtlvtv/torrserver/cache` and
`/home/deploy/svtlvtv/jackett/config` (container paths remain `/opt/ts/config`,
`/opt/ts/torrents` and `/config`). Do not start a local full stack against production
data. Use isolated names, ports and synthetic bind paths for a rehearsal; see
[Operations](#operations) for persistent-data and shutdown precautions.

The API runs in the `Test` environment by default; see
"Configuration" and "Local run" in [`backend/README.md`](backend/README.md),
including the Development mode (a host `go run` against the published database).

Local Compose uses `http://localhost:8092` for MSX, publishes the web service on
`0.0.0.0:8092`, and publishes PostgreSQL on host interfaces at port `5434`. Its `.env` contains
only the environment selector and secrets:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `LAMPA_ENVIRONMENT` | No | `Test` | `lampa-api` environment: `Development`, `Test` or `Production` |
| `LAMPA_DB_PASSWORD` | Yes | None | Password of the `lampa` database role (`openssl rand -hex 32`) |
| `LAMPA_API_DATA_KEY` | Yes | None | Base64 of 32 bytes that seal stored credentials (`openssl rand -base64 32`) |
| `LAMPA_KEYCLOAK_CLIENT_SECRET` | Yes | None | Secret of the `svtlv-lampa` Keycloak client |

`lampa-api` publishes no port: browsers reach it only through the `/api/v1/`
proxy in `lampa-web`, and its health port 8081 stays container-internal. None of
the published ports collide with Svtlv's (`8080` is Keycloak, `5433` is Svtlv's
database). The Keycloak client setup is in
[`backend/README.md`](backend/README.md#keycloak-prerequisites).

Check or stop the local services with:

```bash
docker compose -p lampa ps
docker compose -p lampa logs --tail 100 lampa-web lampa-api
docker compose -p lampa down
```

## Install in MSX

For a manual installation:

1. Host the repository contents on your own HTTPS web server.
2. Replace `{PREFIX}` and `{domain}` in `msx/start.json` with the public address.
3. Confirm that the descriptor is available at
   `https://lampa.example.com/msx/start.json`.
4. Add that descriptor URL in MSX and launch Lampa.

For example, the relevant values in the published descriptor should resolve to:

```json
{
  "parameter": "content:https://lampa.example.com/msx/start.json",
  "action": "link:https://lampa.example.com"
}
```

The Docker image performs this substitution automatically from its `domain` and
`prefix` build arguments.

## Manual deployment to the Svtlv server

The **Build and Deploy Lampa** GitHub Actions workflow runs only when an operator
starts it manually. Pushing or merging a commit does not deploy the application.
It must be started from the default branch (`svtlvtv`) and fails otherwise,
because the deploy pulls the `latest` images that only the default branch
publishes.

Deployments are serialized so that two workflow runs cannot update the server at
the same time.

Every deployment redeploys TorrServer and Jackett too and can interrupt playback
and search. The workflow neither migrates data nor makes backups. Preserve the
existing project, database volume and bind paths described in [Operations](#operations).

The workflow has a single input:

| Input | Default | Description |
| --- | --- | --- |
| `environment` | `Production` | `lampa-api` environment written to the server `.env` as `LAMPA_ENVIRONMENT`: `Development`, `Test` or `Production`. Development is for a local `go run` only (a container cannot reach the database), so the workflow rejects it before building or stopping anything |

`Test` currently has a localhost public origin for local Compose. Set a reachable
Test origin in `appsettings.Test.json` before dispatching a Test server deploy.

The workflow performs the following operations:

1. Validates the branch and all required repository secrets and variables,
   including the format of `LAMPA_DB_PASSWORD` and `LAMPA_API_DATA_KEY`, and
   reads the selected `Authentication.PublicURL` from the appsettings files.
2. Builds `ghcr.io/<owner>/lampa-web` and `ghcr.io/<owner>/lampa-api` and publishes
   them to GitHub Container Registry (GHCR) with the branch, `<branch>-<sha>` and
   `latest` tags.
3. Rewrites the Compose file for release: swaps `lampa-web:dev` / `lampa-api:dev`
   for the `latest` GHCR images and strips the `build:` blocks with `sed`.
   TorrServer and Jackett retain their pinned vendor images.
4. Connects the GitHub-hosted runner to the server's tailnet and configures SSH.
5. Copies the Compose file and a generated `.env` to `DEPLOY_DIR`.
6. Logs the server in to GHCR, checks the Compose configuration, pulls the images,
   stops the running containers and starts all five services with `docker-compose`.
7. Prunes old images after `docker-compose up -d --no-build` succeeds.

The workflow does not poll container health. Compose still waits for a healthy
database before starting the API. Use [Verify a deployment](#verify-a-deployment)
to check the running stack.
The workflow does not run the backend tests either; the **Tests** workflow (`tests.yaml`) gates PRs and pushes to
`svtlvtv`, so merge only green changes before deploying.

The Compose layout the `sed` strip depends on is described in the header comment of
`devops/docker-compose.yaml`: each built service lists `image:` before its `build:`
block, only `context:` and `args:` sit between `build:` and `dockerfile:`, and no
other line, comments included, contains `build:`.

### Server prerequisites

The target server must have:

- Docker Engine;
- the `docker-compose` executable;
- an SSH user that can create `DEPLOY_DIR` and run Docker commands;
- Tailscale connectivity from the GitHub Actions runner to `svtlv`;
- port `8092` available for `lampa-web`, reachable through LAN or Tailscale;
- TCP port `5434` (`lampa-db`) available;
- TCP ports `8090` and `9117` and container names `torrserver` and `jackett`
  available for their Compose services, with the persistent bind directories available;
- a `svtlv-lampa` client in the Svtlv Keycloak realm, set up as described in
  [`backend/README.md`](backend/README.md#keycloak-prerequisites).

Local Compose and automated deployments use port `8092` because port `8080` is
already used by Keycloak on the Svtlv server. The API publishes no port; it is
reached through the `/api/v1/` proxy in `lampa-web`.

### Required GitHub Actions secrets

Configure these under **Repository settings → Secrets and variables → Actions →
Secrets**:

| Secret | Description |
| --- | --- |
| `DEPLOY_DIR` | Existing deployment path `/home/deploy/svtlvtv`; preserve its basename for project/volume identity |
| `TAILSCALE_AUTHKEY` | Auth key for runner tailnet access |
| `SSH_USER` | User that performs the remote deployment |
| `SSH_PRIVATE_KEY` | Private SSH key authorized for `SSH_USER` on the server |
| `GHCR_PAT` | GitHub personal access token with `read:packages` permission |
| `LAMPA_DB_PASSWORD` | 64 lowercase hex characters (`openssl rand -hex 32`) |
| `LAMPA_API_DATA_KEY` | Base64 of exactly 32 bytes (`openssl rand -base64 32`) |
| `LAMPA_KEYCLOAK_CLIENT_SECRET` | Secret of the `svtlv-lampa` Keycloak client |

**Back up `LAMPA_API_DATA_KEY` outside GitHub.** It seals values selected by the
client's `encrypt` list, currently TorrServer login/password. Jackett and Prowlarr
credentials remain local. Losing or changing the key makes sealed values unreadable;
key rotation is not implemented. `LAMPA_DB_PASSWORD` applies only when the
`lampa_db_data` volume is first initialized; see
[`backend/README.md`](backend/README.md) for rotating it.

`GITHUB_TOKEN` is supplied automatically by GitHub Actions and is used to check
out the repository and push the images produced by the workflow.

The workflow hardcodes `svtlv:8092` and `http://` in the MSX build, connects to
`svtlv` over Tailscale, and publishes the released web service as `8092:80` on all
host interfaces. The public URL and Keycloak Authority are checked into
the environment-specific appsettings files.

### Run a deployment

The workflow file must exist on the repository's default branch before GitHub shows
the **Run workflow** button. Once it is available:

1. Open the repository on GitHub.
2. Select **Actions → Build and Deploy Lampa**.
3. Select **Run workflow**.
4. Start the run, monitor every step, then verify container and application health.

No deployment occurs until an operator completes these steps.

The workflow creates the directory configured by `DEPLOY_DIR` automatically.
With `DEPLOY_DIR=/home/deploy/svtlvtv`, the deployment layout includes its
existing persistent data:

```text
/home/deploy/svtlvtv/
├── .env
├── docker-compose.yaml
├── torrserver/
│   ├── config/
│   └── cache/
└── jackett/
    └── config/
```

The generated `.env` file is set to mode `600`. It records `LAMPA_ENVIRONMENT`,
the Keycloak client secret, the database password and the data key;
SSH, Tailscale, and registry credentials are not written into it or into the
application images. It sets no `COMPOSE_PROJECT_NAME`, so the project name stays
the `DEPLOY_DIR` basename and container and volume names are stable across
deployments.

### Verify a deployment

On the server:

```bash
DEPLOY_DIR=/home/deploy/svtlvtv
cd "$DEPLOY_DIR"
PUBLIC_URL=http://svtlv:8092
docker-compose ps
docker inspect --format '{{.State.Health.Status}}' svtlvtv_lampa_web
docker-compose logs --tail 100 lampa-web
curl --fail "$PUBLIC_URL/"
```

The web port is published on all host interfaces; checking the public URL also
verifies the intended client route.

Also check the API and its database. The health port is not published on the
host, so query it from inside the container:

```bash
docker inspect --format '{{.State.Health.Status}}' svtlvtv_lampa_api svtlvtv_lampa_db
docker exec svtlvtv_lampa_api curl -s http://localhost:8081/health
curl -s -w ' %{http_code}\n' "$PUBLIC_URL/api/v1/session"
docker-compose logs lampa-api | grep -m1 Environment
```

`/health` lists a `keycloak` check that is advisory: it reports `Degraded`, never
unhealthy, when Keycloak is unreachable. The session request goes through the web
proxy and answers `200` with `{"authenticated":false}`. The startup log names the
environment selected by the workflow input.

Check the vendor health states too:

```bash
docker inspect --format '{{.Name}} {{.State.Status}} {{.State.Health.Status}}' torrserver jackett
```

Healthy HTTP endpoints do not establish working searches, saved data or playback.
After an upgrade, compare retained settings, saved torrents, indexers and credentials
privately and check the affected client operation. Do not put configuration exports
or credentials in Git or shared logs. See [Operations](#operations) for safe changes.

### Operations

`devops/docker-compose.yaml` is authoritative for images, paths, ports and runtime
settings. Keep `DEPLOY_DIR=/home/deploy/svtlvtv` and its project identity unchanged
so deployments reuse the `svtlvtv_lampa_db_data` database volume.

| Persistent host directory | Container path | Application UID:GID |
| --- | --- | --- |
| `/home/deploy/svtlvtv/torrserver/config` | `/opt/ts/config` | `0:0` |
| `/home/deploy/svtlvtv/torrserver/cache` | `/opt/ts/torrents` | `0:0` |
| `/home/deploy/svtlvtv/jackett/config` | `/config` | `1000:1000` |

Back up the complete bind directories, PostgreSQL data and protected `.env`,
including `LAMPA_API_DATA_KEY`. Use stopped writers or application-supported
consistent backups, preserve ownership/permissions and verify recovery material
before upgrades. Never regenerate credentials or recursively chown all data to
`deploy`; the applications use the identities above. Do not delete these binds
or the database volume during routine container replacement.

Every deployment can interrupt playback/search. TorrServer's `TS_DONTKILL=1`
ignores SIGTERM, so ordinary stop/down can reach Docker's forced-kill deadline.
For graceful maintenance, prevent automatic restart, use the supported
authenticated `GET /shutdown`, then confirm the process has exited. That endpoint
is mutating and must never be a health probe.

TorrServer settings changes require the **full settings object**, not a sparse
patch, and reconnect the torrent client, dropping active torrents. Change settings
only while idle, keep a private complete rollback export, and verify full readback
and functionality afterward. An HTTP success alone does not prove a settings save.

Monitoring and incident history belong in the administration workspace, not an
open-ended application backlog. Create focused items for evidence-backed defects
or deliberately scheduled improvements. The [playback measurement guide](docs/parallel-playback-validation.md)
and `devops/measure-playback.sh` remain optional investigation tools, not scheduled
acceptance work or proof of playback capacity.

### Roll back

The workflow has no rollback inputs. To roll back, revert the offending commit on
`svtlvtv` and start the workflow again; it rebuilds and deploys `latest`. The
`lampa_db_data` volume survives redeployments.

Reverting a vendor image does not restore bind data rewritten by the newer binary.
Stop writers, preserve post-upgrade state, and restore a verified compatible backup
when needed. Reconcile new writes before accepting an older recovery point; never
run old and new writers against the same writable state.

### Troubleshooting

- **Missing required repository secret or variable** — add the named secret or
  variable and start the workflow again.
- **Tailscale ping fails** — confirm the auth key is valid and `svtlv` is
  reachable from the same tailnet.
- **SSH authentication fails** — verify `SSH_USER`, the private key, and the matching
  public key in the server user's `authorized_keys` file.
- **GHCR returns `denied` or `unauthorized`** — verify that `GHCR_PAT` belongs
  to a user with package access and includes `read:packages`.
- **Port is already allocated** — identify the conflicting service before changing
  anything; the stack uses ports `8092`, `5434`, `8090` and `9117`.
- **Container is unhealthy** — inspect
  `docker-compose logs --tail 100 lampa-web` and confirm that Apache can serve
  `/` inside the container.
- **Stack startup failed** — inspect the Compose error and the affected service's
  health and bounded logs. For API failures, inspect
  `docker-compose logs --tail 100 lampa-api lampa-db`; the usual causes are a
  wrong `LAMPA_DB_PASSWORD` for an already initialized database volume or a
  malformed `LAMPA_API_DATA_KEY`.
- **Development is for a local go run only** — the workflow rejects
  `environment: Development` because it points the API at `localhost` inside its
  container; deploy Test or Production.
- **Deploy must run from the default branch** — start the workflow from
  `svtlvtv`; merge the change there first.
- **Tests fail** — run `make lint`, `make test` and `make race` in `backend/` as
  described in [`backend/README.md`](backend/README.md).

## Working with this distribution repository

The upstream project publishes generated files into this repository. In particular:

- edit `app.min.js` directly for upstream application changes;
- put fork-only features in `svtlv/` as add-ons that use only `window.Lampa`, never
  in `app.min.js`, `css/app.css` or `lang/*`, and keep the marked
  `<!-- svtlv:begin -->` … `<!-- svtlv:end -->` block of `index.html` when taking
  upstream files;
- edit `css/app.css` directly for style changes;
- update both the inline `ru`/`en` dictionaries in `app.min.js` and the matching
  `lang/ru.js` or `lang/en.js` file when adding translations;
- keep changes small because upstream updates frequently replace the complete bundle;
- verify changes by serving the repository and exercising them in the target browser
  or television environment.

The stable plugin API is exposed through `window.Lampa`. Internal variable
suffixes inside the compiled bundle are build artifacts and should not be treated
as public API.

## Security

Lampa supports third-party plugins. Plugins execute code inside the application
and must be treated as untrusted unless you have reviewed their source. Install
plugins only from sources you trust and review the repository's
[security policy](SECURITY.md) before deploying the application for other users.

Never commit SSH keys, Tailscale auth keys, GitHub tokens, or generated deployment
environment files to this repository.

## License

This distribution is licensed under the [GNU General Public License version 2](LICENSE).
