#!/usr/bin/env bash
# Read-only deployment checks. Run on the intended Linux Docker host.
set +x
set -euo pipefail

deployment_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$deployment_root"

mode="${1:-https}"
if [[ "$mode" != "https" && "$mode" != "tunnel" ]]; then
  printf '%s\n' 'Usage: bash deploy/preflight.sh [https|tunnel]' >&2
  exit 1
fi
if [[ ! -f .env.deploy ]]; then
  printf '%s\n' 'Missing .env.deploy. Copy .env.deploy.example and fill it privately.' >&2
  exit 1
fi
if [[ "$(uname -s)" != "Linux" ]]; then
  printf '%s\n' 'Run this preflight on the intended Linux deployment host.' >&2
  exit 1
fi
if [[ "$(stat -c '%a' .env.deploy)" != "600" ]]; then
  printf '%s\n' 'Restrict the credential file first: chmod 600 .env.deploy' >&2
  exit 1
fi
command -v docker >/dev/null || { printf '%s\n' 'Docker is not installed.' >&2; exit 1; }
docker compose version >/dev/null
docker_platform="$(docker info --format '{{.OSType}}/{{.Architecture}}')"
if [[ "$docker_platform" != "linux/x86_64" && "$docker_platform" != "linux/amd64" ]]; then
  printf '%s\n' 'The published image requires a Linux amd64 Docker host.' >&2
  exit 1
fi

compose=(docker compose --env-file .env.deploy -f compose.yaml)
if [[ "$mode" == "https" ]]; then
  compose+=(-f compose.tencent.yaml)
fi
# --quiet avoids printing interpolated application and provider credentials.
"${compose[@]}" config --quiet
printf '%s\n' 'Configuration passed. No containers, resources, or credentials were changed.'
printf '%s\n' 'Still verify DNS, firewall, image availability, TLS, login and provider access.'
