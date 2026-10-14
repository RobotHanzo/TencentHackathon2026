# Deploy Clearport

The GitHub workflow validates the application and publishes a container image to GHCR. Deployment is a manual Docker Compose operation; the workflow does not connect to or update a remote server.

This is a **single-instance, single-operator prototype** with SQLite and a fixed user identity. Container packaging does not add team authentication, SSO, or high availability. Use sample data until the access and governance limitations in the [README](README.md#access-governance-and-deployment-limits) are addressed.

## Publish an image

The workflow in [.github/workflows/docker.yml](.github/workflows/docker.yml) runs the build, server tests, browser tests, and container smoke checks before publication. It publishes the exact tested `linux/amd64` image without rebuilding it.

| Trigger                       | Result                                                                   |
| ----------------------------- | ------------------------------------------------------------------------ |
| Pull request targeting `main` | Validation only.                                                         |
| Push to `main`                | Publish `main` and `sha-<full-40-character-commit-SHA>`.                 |
| Push a `v*` tag               | Publish the exact tag, such as `v1.0.0`, and the full SHA tag.           |
| Manual workflow dispatch      | Validate the selected ref; publish only when it is `main` or a `v*` tag. |

For this repository, the image is `ghcr.io/robothanzo/tencenthackathon2026`. Forks use their own lowercase owner/repository name. The publishing job uses GitHub's `GITHUB_TOKEN` with `packages: write`; no registry password needs to be added to repository secrets. A newly published package is private by default. Keep it private and grant the intended account access, or explicitly change its visibility in the package settings. [GitHub Container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Wait for a successful publishing run before pulling an image. For private images, authenticate with a GitHub personal access token **(classic)** that has `read:packages` and access to the package. Supply the token through your secret manager or session environment, then use standard input:

```powershell
$env:GHCR_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

In Bash, use `printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin`. Public images can be pulled anonymously. Do not put a registry token in the application environment file.

## Start with Compose

Use a Docker host with Linux containers and a current Docker Compose plugin. Published images target `linux/amd64`. Run commands from a checkout containing [compose.yaml](compose.yaml).

Copy [.env.deploy.example](.env.deploy.example) to `.env.deploy`:

```powershell
Copy-Item .env.deploy.example .env.deploy
```

On Linux/macOS, use `cp .env.deploy.example .env.deploy`. Edit the copy and set a strong, unique `APP_ACCESS_PASSWORD` of at least 12 characters. `.env.deploy` is ignored by Git; restrict access to it on the deployment host.

| Setting in `.env.deploy`                | Purpose                                                                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLEARPORT_IMAGE`                       | Defaults to `ghcr.io/robothanzo/tencenthackathon2026:main`. Prefer a published full SHA tag for a repeatable deployment.                                                     |
| `CLEARPORT_PORT`                        | Host port, default `3001`, bound to `127.0.0.1`. Use another port, such as `3002`, if the local development API occupies it.                                                 |
| `APP_ACCESS_PASSWORD`                   | Required HTTP Basic password.                                                                                                                                                |
| `APP_USER_ID`                           | Fixed existing workspace user, default `manager-sarah`. This does not create an account.                                                                                     |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Optional provider configuration. Leave all three empty for local checks and knowledge retrieval. Setting all three can send document and knowledge content to that provider. |

```sh
docker compose --env-file .env.deploy pull
docker compose --env-file .env.deploy up -d --wait
docker compose --env-file .env.deploy ps
docker compose --env-file .env.deploy logs --tail=100 clearport
```

Open `http://127.0.0.1:3001` using your chosen host port. The HTTP Basic username is **`clearport`** and the password is your `APP_ACCESS_PASSWORD`. `/api/health` is intentionally unauthenticated; the container health check uses it. A healthy container indicates the process is responding, not that an optional AI provider has been validated.

The first run seeds **fictional Singapore cases and users**, including in non-demo mode. Subsequent runs retain the workspace in the `clearport_data` volume mounted at `/app/data`; Compose prefixes the Docker volume name with the project name, `clearport`. The database is `/app/data/clearport.db`. Keep the same project name and volume when updating so the existing workspace remains attached.

Compose fixes `NODE_ENV=production`, `DEMO_MODE=false`, `HOST=0.0.0.0`, and container `PORT=3001`. The service runs as the unprivileged `node` user, with a read-only root filesystem, writable data volume and temporary directory, dropped capabilities, and no privilege escalation. Its restart policy is `unless-stopped`, with a 30-second graceful-stop period. Persona switching is disabled, and authors still cannot approve their own documents.

## Build locally instead

This path does not require a published GHCR image:

```sh
docker build -t clearport:local .
```

Set `CLEARPORT_IMAGE=clearport:local` in `.env.deploy`, then run:

```sh
docker compose --env-file .env.deploy up -d --wait --pull never
```

The multistage image uses Node 24 on Debian Bookworm Slim, builds the client with the locked dependencies, and installs runtime dependencies separately. The final command is `node --import tsx server/index.ts`.

## Access from another machine

The supplied configuration exposes the service only on the Docker host's loopback interface. For remote browser access, put an HTTPS reverse proxy on that host; **TLS certificates and proxy configuration are not supplied**. Preserve the original `Host` header so the application's same-origin checks work. The app does not trust forwarded protocol headers, so the proxy should also add the `Secure` flag to the session cookie.

For an existing HTTPS Nginx server, the relevant location block is below. Adjust the upstream port if you changed `CLEARPORT_PORT`; the 11 MB request limit accommodates a 10 MB upload plus multipart overhead. [Nginx proxy directives](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cookie_flags).

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_cookie_flags clearport_session secure;
    client_max_body_size 11m;
}
```

Keep the backend port private and serve the external site exclusively over HTTPS. A proxy running in another container needs explicit networking; its own `127.0.0.1` does not refer to the Clearport host.

For an operator-only connection, an SSH tunnel is another option:

```sh
ssh -N -L 127.0.0.1:3002:127.0.0.1:3001 user@your-server
```

While the tunnel is open, visit `http://127.0.0.1:3002` and use the same Basic credentials. Adjust both ports to match your setup.

## Backup, update, and roll back

Before changing versions, record the current `CLEARPORT_IMAGE` and back up the **entire data directory while the service is stopped**. Use a new destination name for every backup:

```sh
docker compose --env-file .env.deploy stop clearport
docker compose --env-file .env.deploy cp clearport:/app/data/. ./clearport-backup-YYYYMMDD-HHMMSS
docker compose --env-file .env.deploy start --wait clearport
```

Replace the date placeholder with a unique name. Check that the backup contains `clearport.db`, and retain any `-wal` or `-shm` files present. Copying only the database while it is active can produce an inconsistent snapshot. Store the backup securely outside the container host. [Docker Compose copy reference](https://docs.docker.com/reference/cli/docker/compose/cp/), [SQLite backup guidance](https://www.sqlite.org/howtocorrupt.html#backup_or_restore_while_a_transaction_is_active).

For an update, set `CLEARPORT_IMAGE` to a successfully published tag such as `ghcr.io/robothanzo/tencenthackathon2026:sha-<full-40-character-SHA>`, then run:

```sh
docker compose --env-file .env.deploy pull
docker compose --env-file .env.deploy up -d --wait
docker compose --env-file .env.deploy logs --tail=100 clearport
```

Confirm login, existing knowledge, and a sample workflow. To roll back application code, restore the previous full SHA image reference and repeat those commands. The image change does not roll back the database: use an older image only with compatible data. If data restoration is needed, stop the service and restore the complete snapshot into an empty data volume, with ownership writable by UID/GID `1000:1000`, before restarting. Do not mix a restored database with another snapshot's WAL files.

`docker compose down` retains the named volume. **Do not use `down -v` unless you intend to delete the stored workspace.** Run one service instance against its local volume; this SQLite prototype is not configured for replicas or a shared network filesystem.
