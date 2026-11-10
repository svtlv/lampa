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
| `docs/` | Designs, implementation plans, container handover and playback validation |

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
tag; see the [service inventory](docs/container-migration-inventory.md).
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
`/opt/ts/torrents` and `/config`). For initial adoption, follow the
[manual cutover runbook](docs/container-migration-runbook.md) before starting them;
stop old writers, perform the offline final sync, pass checksum/metadata comparison
and secure a complete independent pre-upgrade backup before any new writes.
Use isolated names, ports and synthetic bind paths for a rehearsal.

The API runs in the `Test` environment by default; see
"Configuration" and "Local run" in [`backend/README.md`](backend/README.md),
including the Development mode (a host `go run` against the published database).

Local Compose uses `http://localhost:8092` for MSX, publishes the web service on
`0.0.0.0:8092`, and publishes PostgreSQL on `127.0.0.1:5434`. Its `.env` contains
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

Before the first full-stack deployment, complete the old-project shutdown and
backup steps in the [manual cutover runbook](docs/container-migration-runbook.md).
The workflow does not take over old containers or migrate their data. Every
deployment redeploys TorrServer and Jackett too and can interrupt playback and
search. The owner-authorized live pre-copy on November 10, 2026 used
`rsync -aHAX --numeric-ids` to preserve UID/GID/modes; it is not a consistent
backup while sources run. A checksum/metadata dry run reported no changes after
copying; final offline verification and cutover remain unperformed. Sources
remain `/var/lib/torrserver/{config,cache}` and `/opt/svtlvtv/jackett/config` until
cutover. Keep all destination binds under `/home/deploy/svtlvtv/torrserver/` and
`/home/deploy/svtlvtv/jackett/`; source-only cleanup is conditional on successful deployment
and acceptance, not currently authorized. Rollback requires compatible original
data and reconciliation of post-cutover writes; follow the runbook. No deploy-time
guards or automated migration/cleanup are introduced.

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
database before starting the API. Verify service readiness manually using the
[migration runbook](docs/container-migration-runbook.md#4-verify-before-retiring-old-sources).
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
- loopback port `5434` (`lampa-db`) free;
- TCP ports `8090` and `9117` and container names `torrserver` and `jackett` freed
  by the manual handover, with the three preserved bind directories available;
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
4. Start the run and monitor every step until the health check passes.

No deployment occurs until an operator completes these steps.

The workflow creates the directory configured by `DEPLOY_DIR` automatically.
With `DEPLOY_DIR=/home/deploy/svtlvtv`, a successful run produces:

```text
/home/deploy/svtlvtv/
├── .env
└── docker-compose.yaml
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
docker-compose ps lampa-web
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
Follow the runbook's private data and credential comparisons, then the
[playback validation procedure](docs/parallel-playback-validation.md). Tuning
candidates and three-viewer 1080p/single-viewer 4K capacity remain unverified until
those live checks pass. The guide also documents the bounded, read-only Linux
resource collector at `devops/measure-playback.sh` (Bash and Python 3.8 or newer).

### Roll back

The workflow has no rollback inputs. To roll back, revert the offending commit on
`svtlvtv` and start the workflow again; it rebuilds and deploys `latest`. The
`lampa_db_data` volume survives redeployments.

For a vendor upgrade or initial handover rollback, also follow the
[upgrade-aware recovery procedure](docs/container-migration-runbook.md#manual-rollback-after-an-upgrade).
Reverting an image does not restore bind data rewritten by the newer binary.
Stop writers and use verified pre-upgrade backups when compatibility requires it.

### Troubleshooting

- **Missing required repository secret or variable** — add the named secret or
  variable and start the workflow again.
- **Tailscale ping fails** — confirm the auth key is valid and `svtlv` is
  reachable from the same tailnet.
- **SSH authentication fails** — verify `SSH_USER`, the private key, and the matching
  public key in the server user's `authorized_keys` file.
- **GHCR returns `denied` or `unauthorized`** — verify that `GHCR_PAT` belongs
  to a user with package access and includes `read:packages`.
- **Port is already allocated** — stop the conflicting service before deploying
  on port `8092`; use the manual handover for old TorrServer/Jackett containers.
- **Container is unhealthy** — inspect
  `docker-compose logs --tail 100 lampa-web` and confirm that Apache can serve
  `/` inside the container.
- **Stack startup failed** — inspect the Compose error and the runbook's
  service-specific checks. For API failures, inspect
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
