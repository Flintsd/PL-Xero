# PL-Xero Bridge

Express service that accepts PrintLogic/Power Automate payloads, creates Xero invoices, and syncs paid invoices back to PrintLogic.

## Configuration
All runtime settings are provided via environment variables (use `.env` for local dev).

Required variables:
- XERO_CLIENT_ID
- XERO_CLIENT_SECRET
- XERO_REDIRECT_URI
- PL_API_KEY

Common optional variables:
- PORT (default 4002)
- LOG_LEVEL (debug | info | warn | error, default info)
- XERO_SCOPES
- XERO_TENANT_ID
- XERO_SALES_ACCOUNT
- XERO_STRIPE_ACCOUNT
- XERO_STRIPE_ACCOUNT_CODE
- XERO_BRAND_EDINBURGH
- XERO_BRAND_SDK
- XERO_BRAND_GICLEE
- XERO_BRAND_PPS
- PL_API_URL (default https://www.printlogicsystem.com/api.php)

See .env.example for a full template.

## Local development
1) Copy env template:
   cp .env.example .env
2) Install deps:
   npm install
3) Run:
   node xero-bridge.js

To authenticate Xero, visit GET /xero/auth-url and complete the OAuth flow (Xero will redirect to /xero/callback).

## Server (PM2)
npm ci
pm2 start ecosystem.config.js
pm2 save

## Security notes
- Never commit .env, xero-token.json, logs, or node_modules
- xero-token.json is created at runtime and contains OAuth tokens
- Install the optional pre-commit guard:
  npm run install-hooks
