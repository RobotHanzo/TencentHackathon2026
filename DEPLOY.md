# Deploy Clearport

The GitHub workflow validates the application and publishes a container image to GHCR. Deploy that image to a **Linux amd64 Tencent CVM in Singapore** using Docker Compose. The supplied Caddy overlay provides HTTPS. The workflow does not connect to or update a remote server.

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

## Prepare the Tencent host and credentials

Use an existing Singapore CVM, or create one in the Tencent console after choosing its paid resources. Ubuntu 24.04 LTS on x86-64 is a suitable host. A starting point for this prototype is 2 vCPUs, 4 GiB RAM and 40 GiB disk; size it for actual document volume. Install Docker Engine and the Compose plugin using the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). No Node installation is needed on the server.

Keep this information available for deployment:

| Item                                             | Where to get it / how to hand it over                                                                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CVM public IP, SSH username and Singapore region | Tencent CVM instance details. The Linux username depends on the image; confirm it rather than assuming `root`.                                                                                                             |
| SSH private key                                  | Keep the file on your computer and provide its **local path**, never its contents in chat, Git or an issue. Confirm the server's SSH host-key fingerprint through a trusted console before accepting the first connection. |
| Domain and DNS access                            | Point a hostname's A record to the CVM public IPv4 address. Add an AAAA record only if that IPv6 address reaches this host. A domain is optional for the SSH-tunnel path below.                                            |
| Certificate contact email                        | Set `CLEARPORT_TLS_EMAIL` for Caddy certificate notices.                                                                                                                                                                   |
| App access password                              | Store a unique password of at least 12 characters in the host's ignored `.env.deploy` file. Use a password manager.                                                                                                        |
| GHCR access, if the package is private           | A GitHub token with `read:packages` and access to the package; enter it interactively on the host. It is separate from app credentials.                                                                                    |
| ADP application API key                          | Publish the intended ADP application, then copy its application API key from the application's API access settings into `ADP_APP_KEY`. This is **not** a Tencent Cloud account SecretKey or an application ID.             |

No Tencent account-wide SecretId/SecretKey is needed to deploy to an existing host over SSH or to call the ADP chat endpoint with an application key. Optional ADP knowledge synchronization and original-file archival use separate, narrowly scoped Tencent API credentials; do not substitute those credentials for `ADP_APP_KEY`.

Configure the CVM security group and host firewall to allow TCP **22 from your operator IP**, and TCP **80/443** for HTTPS access and certificate validation. Do not expose port 3001. Allow outbound HTTPS for image pulls, certificate issuance and the selected model provider. Caddy needs a hostname that resolves to the server, reachable ports and persistent certificate storage. [Caddy HTTPS requirements](https://caddyserver.com/docs/automatic-https).

The application database resides on the selected CVM's Docker volume. Optional original-file archival requires an existing private Singapore COS bucket as described below; this package does not provision a bucket or schedule database backups. Singapore CVM placement does **not** establish ADP/model processing residency: the [ADP data-processing terms](https://www-sg.tencentcloud.com/document/product/1254/69989) do not provide a Singapore-only guarantee. Confirm the selected ADP tenant, endpoint and model processing/storage locations with Tencent before sending real customer documents. Until then, use fictional data, or keep both `AI_PROVIDER=local` and `ADP_KNOWLEDGE_SYNC=false`.

## Configure the host

Transfer `compose.yaml`, `compose.tencent.yaml`, `.env.deploy.example`, and the `deploy/` directory to the same directory on the CVM, for example `~/clearport`. These files contain no real credentials. From PowerShell, after confirming the host-key fingerprint:

```powershell
ssh -i "C:\Keys\clearport.pem" ubuntu@YOUR_CVM_IP "mkdir -p ~/clearport/deploy"
scp -i "C:\Keys\clearport.pem" compose.yaml compose.tencent.yaml .env.deploy.example ubuntu@YOUR_CVM_IP:clearport/
scp -i "C:\Keys\clearport.pem" deploy/Caddyfile deploy/preflight.sh ubuntu@YOUR_CVM_IP:clearport/deploy/
```

Replace the key path, username and IP with the actual target; do not disable SSH host-key verification.

On the Linux host:

```sh
cd ~/clearport
umask 077
cp -n .env.deploy.example .env.deploy
chmod 600 .env.deploy
nano .env.deploy
```

`cp -n` preserves an existing configuration. Edit it privately; do not paste credentials into shell command arguments or send the file through chat. Compose reads this ignored file; it is not part of the image. Docker administrators can inspect container environment variables, so restrict access to the host and Docker socket. Use single-quoted values if a password contains characters such as `$` that Compose would otherwise expand.

| Setting                                 | Purpose                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLEARPORT_IMAGE`                       | A successfully published image. Prefer `ghcr.io/robothanzo/tencenthackathon2026:sha-<full-40-character-commit-SHA>` for repeatable deployment.           |
| `CLEARPORT_PORT`                        | Private host port, default `3001`, bound to `127.0.0.1`.                                                                                                 |
| `CLEARPORT_DOMAIN`                      | HTTPS hostname only, such as `clearport.example.com`; no scheme, path or port. Required by the Tencent overlay.                                          |
| `CLEARPORT_TLS_EMAIL`                   | Certificate contact email. Required by the Tencent overlay.                                                                                              |
| `APP_ACCESS_PASSWORD`                   | Required HTTP Basic password, at least 12 characters. Username: `clearport`.                                                                             |
| `APP_USER_ID`                           | Fixed existing workspace user, default `manager-sarah`. It does not create an account.                                                                   |
| `APP_COOKIE_SECURE`                     | The HTTPS overlay forces `true`. Base Compose defaults to `false` for localhost/SSH-tunnel HTTP.                                                         |
| `AI_PROVIDER`                           | `local` (default), `adp`, or `openai`. Selecting `local` keeps model requests local.                                                                     |
| `ADP_APP_KEY`                           | Published ADP application API key, required when selecting `adp`.                                                                                        |
| `ADP_ENDPOINT`                          | Defaults to `https://wss.lke.tencentcloud.com/adp/v2/chat`. Use the endpoint applicable to your ADP application. Its hostname is not a region guarantee. |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | All three are required for the optional `openai` compatible provider.                                                                                    |

For ADP, set `AI_PROVIDER=adp` and fill `ADP_APP_KEY`. Follow the [agent setup and copyable instructions](deploy/adp-agent.md) before publishing the application. Enabling an external provider sends relevant prompts, document text and approved knowledge context to that provider. A chat connection alone does not prove that the platform's knowledge library has been synchronized into an ADP-managed knowledge base.

### Optional ADP knowledge synchronization

Use a dedicated ADP application for Clearport and configure these additional settings privately:

| Setting                                   | Purpose                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADP_KNOWLEDGE_SYNC`                      | Default `false`; set `true` to enable synchronization of approved knowledge. This sends content to ADP independently of the chat provider selection.                       |
| `ADP_APP_BIZ_ID`                          | The ADP application's business ID used by the management API. It is separate from the application API key.                                                                 |
| `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY` | Tencent API credentials for an identity allowed to manage this ADP application. Use a scoped CAM sub-account/role; do not share the account owner's credentials.           |
| `TENCENT_TOKEN`                           | Session token when using temporary Tencent credentials; leave empty for a long-lived scoped key. Rotate or refresh credentials before they expire.                         |
| `TENCENT_REGION`                          | Default `ap-jakarta` for the ADP management API. This is **not** the Singapore CVM region. Verify the selected API region and tenant entitlement in Tencent.               |
| `ADP_AUTO_PUBLISH`                        | Default `false`: uploaded drafts wait for publication in the ADP console. `true` publishes **all drafts in the ADP app**, so enable it only for a dedicated Clearport app. |

The integration uses the legacy LKE management API version `2023-11-30`, which Tencent marks deprecated in its [SaveDoc documentation](https://www.tencentcloud.com/document/product/1254/70209). Confirm that your account can use that API and the chosen region before relying on synchronization. Chat entitlement does not establish management-API entitlement. This path is application-scoped; it does not need a separate knowledge-base ID. ADP supplies a temporary upload location internally; no general-purpose COS bucket credentials are required for this sync path.

Keep `ADP_KNOWLEDGE_SYNC=false` until these credentials and processing locations are confirmed. With synchronization enabled, check its status in the application and retry failures after resolving the cause. If automatic publication is off, publish the uploaded drafts in the ADP console before expecting the ADP agent to retrieve them. Verify the complete path with fictional notes first; configuration validation is not a live API test.

### Optional original-file archive in Singapore COS

Create or select a dedicated **private** COS bucket in **Singapore (`ap-singapore`)**. Keep public-read and public-write access disabled. Set `COS_BUCKET` to the exact bucket name shown in the console, including its account suffix, and `COS_REGION=ap-singapore`. Leaving `COS_BUCKET` empty disables this feature. Setting an environment region does not move an existing bucket; confirm its actual location in the console.

Original uploaded files use this bucket independently of ADP knowledge synchronization. Give the configured Tencent identity only the required `cos:PutObject` access to this bucket's `originals/*` prefix. The app does not require public object URLs. The same `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY` and optional `TENCENT_TOKEN` settings serve the enabled sync/archive features; scope that identity to their combined required permissions rather than using the root account.

This archive preserves original uploads; it does not back up the SQLite workspace, reviewer decisions or Caddy certificates. Use the stopped-database backup procedure below, then upload that completed snapshot privately through the COS console if desired. No automatic backup schedule is supplied.

If GHCR is private, log in without placing the token in shell history or `.env.deploy`:

```sh
read -r -p 'GitHub username: ' GHCR_USER
read -r -s -p 'GHCR read:packages token: ' GHCR_TOKEN
printf '\n'
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
unset GHCR_TOKEN
```

Docker retains registry login credentials in its configured credential store; protect that store. Use `docker logout ghcr.io` when access is no longer needed.

## Deploy with HTTPS

Run the read-only host preflight, pull the published images, validate Caddy and start the stack:

```sh
bash deploy/preflight.sh https
docker compose --env-file .env.deploy -f compose.yaml -f compose.tencent.yaml pull
docker compose --env-file .env.deploy -f compose.yaml -f compose.tencent.yaml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file .env.deploy -f compose.yaml -f compose.tencent.yaml up -d --wait
docker compose --env-file .env.deploy -f compose.yaml -f compose.tencent.yaml ps
```

Open `https://YOUR_DOMAIN`. Caddy obtains and renews certificates and redirects HTTP to HTTPS. Its pinned image is `caddy:2.11.7-alpine`, corresponding to the [official Caddy release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7). The proxy preserves the original Host header, accepts uploads up to 11 MB, and reaches the backend over the private Docker network. [Caddy reverse-proxy reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Check the unauthenticated health endpoint, then sign in through the browser with username `clearport` and the app password:

```sh
curl --fail --silent --show-error https://YOUR_DOMAIN/api/health
```

Confirm that HTTPS is trusted, the `clearport_session` cookie has `Secure`, `HttpOnly` and `SameSite=Strict`, and an unauthenticated `/api/state` request receives HTTP 401. Import a fictional note, publish it as the configured manager, and ask a relevant agent question. Verify the provider shown in the answer and its citations. Health reports process/configuration status; it does **not** validate an ADP key, quota or model response.

The root filesystem is read-only; `clearport_data` stores SQLite and `caddy_data`/`caddy_config` retain Caddy state. Caddy starts only after the app health check passes. Never scale the app to multiple replicas against this SQLite volume. Inspect errors with `docker compose --env-file .env.deploy -f compose.yaml -f compose.tencent.yaml logs --tail=100`, but do not share logs before checking for sensitive content. Use `config --quiet`, never plain `config`, in shared terminals or CI because rendered Compose configuration contains secrets.

## Localhost or SSH tunnel (no domain)

Use a Docker host with Linux containers and a current Docker Compose plugin. Published images target `linux/amd64`. Run commands from a checkout containing [compose.yaml](compose.yaml).

Configure [.env.deploy.example](.env.deploy.example) as described above. For a fresh local PowerShell checkout, preserve any existing configuration:

```powershell
if (-not (Test-Path .env.deploy)) { Copy-Item .env.deploy.example .env.deploy }
```

On Linux/macOS, use `cp -n .env.deploy.example .env.deploy`. Set a strong, unique `APP_ACCESS_PASSWORD` of at least 12 characters and keep `APP_COOKIE_SECURE=false` for this HTTP-only path. `.env.deploy` is ignored by Git; restrict access to it on the deployment host.

| Setting in `.env.deploy`                | Purpose                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `CLEARPORT_IMAGE`                       | Defaults to `ghcr.io/robothanzo/tencenthackathon2026:main`. Prefer a published full SHA tag for a repeatable deployment.     |
| `CLEARPORT_PORT`                        | Host port, default `3001`, bound to `127.0.0.1`. Use another port, such as `3002`, if the local development API occupies it. |
| `APP_ACCESS_PASSWORD`                   | Required HTTP Basic password.                                                                                                |
| `APP_USER_ID`                           | Fixed existing workspace user, default `manager-sarah`. This does not create an account.                                     |
| `AI_PROVIDER`                           | Use `local`, `adp`, or `openai` as described above.                                                                          |
| `ADP_APP_KEY`, `ADP_ENDPOINT`           | Tencent ADP connection when `AI_PROVIDER=adp`.                                                                               |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Optional provider connection when `AI_PROVIDER=openai`.                                                                      |

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

## Existing reverse proxy

Base Compose exposes the service only on the Docker host's loopback interface. The Tencent overlay supplies Caddy; alternatively, use your own HTTPS reverse proxy and set `APP_COOKIE_SECURE=true` in `.env.deploy`. Preserve the original `Host` header so the application's same-origin checks work. The app does not need to trust forwarded protocol headers to mark the cookie secure.

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

For an operator-only connection without a domain, start **base Compose only**, keep `APP_COOKIE_SECURE=false`, and allow SSH from your operator IP. From your local computer:

```sh
ssh -i /path/to/private-key -N -L 127.0.0.1:3002:127.0.0.1:3001 user@your-server
```

While the tunnel is open, visit `http://127.0.0.1:3002` and use the same Basic credentials. Adjust both ports to match your setup.

## Backup, update, and roll back

The commands below use base Compose and affect the app only. If you deployed the HTTPS overlay, add `-f compose.yaml -f compose.tencent.yaml` to each Compose command to preserve the HTTPS cookie setting and manage the complete stack. Keep both Caddy volumes across updates so certificates and account keys persist.

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
