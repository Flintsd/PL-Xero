# Security & Maintainability Review (Secrets + Ops Safety)

## Scope
Reviewed secrets handling, configuration, and operational safety for the PL-Xero Node.js service.

## Findings
- No hardcoded secrets found in tracked files; config values are read from `process.env`.
- Local sensitive artifacts exist in the workspace (`.env`, `xero-token.json`, `*.log`) and must remain untracked.
- Logging includes full request payloads and invoice models; this is unchanged but should be reviewed for PII exposure in production logs.

## Changes made
- Added `.env.example`, `config.example.js`, and `logicConfig.example.js` templates.
- Updated `.gitignore` to allow committing `.env.example` while still blocking real env files.
- Added optional pre-commit guardrails to block committing secrets/tokens/logs.
- Updated PM2 config to prefer `process.env.PORT`.
- Added `README.md` with setup, required env vars, and security notes.

## How to deploy on the server
```
cd /var/projects/pl-xero
git pull origin main
npm ci
pm2 start ecosystem.config.js --env production
pm2 save
```

If PM2 is already running this app, use:
```
pm2 reload xero-bridge
```

## Verification
- No secrets were printed or inspected.
- Skipped runtime execution checks (would require live credentials and network access).
