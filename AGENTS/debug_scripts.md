# Debug and Test Script Requirements

Last updated: 2026-02-08 18:13:21 UTC

## Non-Negotiable Rules

- Never hardcode database credentials.
- Always load env from `api/.env` (or environment-injected secrets in CI).
- Do not use fallback default passwords for non-local workflows.
- Do not run destructive scripts against shared or production data unless explicitly intended and isolated.

## Database Env Variables

Use only configured variables:

- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- or `DATABASE_URL`

## Script Placement

- Keep one-off utilities in `api/scripts/`.
- Do not place non-test utilities under `api/__tests__/`.
- Jest discovery should only include actual test files.

## Safety Defaults

- Prefer read-only scripts for diagnostics.
- For write scripts, require an explicit flag such as `--confirm`.
- Log target environment and connection info before execution.
- For batch jobs, support `--dry-run` where practical.

## Current Cleanup Priority

The backend test tree currently contains stale and utility files that break the suite. See `FIXME.md` for cleanup tasks.
