# PL-Xero Bridge

Express service that accepts PrintLogic/Power Automate payloads, creates Xero invoices, and syncs paid invoices back to PrintLogic.

## Configuration
All runtime settings are provided via environment variables (use .env for local dev).

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
cp .env.example .env
npm install
node xero-bridge.js

To authenticate Xero, visit GET /xero/auth-url and complete the OAuth flow (Xero will redirect to /xero/callback).

## Manual test (create invoice)
Example payload with an `order_number` so PL writeback can run:

```bash
curl -s -X POST http://localhost:4002/create-invoice \
  -H "Content-Type: application/json" \
  -d '{
    "order_number": "6789",
    "order_po": "WEB-1234",
    "pl_order": {
      "customer_name": "Test Customer",
      "customer_email": "test@example.com"
    },
    "lineItems": [
      { "description": "Test item", "quantity": 1, "unitAmount": 10.0 }
    ]
  }'
```

Check logs for the PL writeback lines (writeback happens on create, not paid):
- `[PL] after-create status update: order 6789 -> "Pre-Press"`
- `[PL] after-create invoice ref updated: order 6789, invoice INV-...` (when `PL_INVOICE_REF_ACTION` is set)

## Server (PM2)
npm ci
pm2 start ecosystem.config.js
pm2 save

## Security notes
- Never commit .env, xero-token.json, logs, or node_modules
- xero-token.json is created at runtime and contains OAuth tokens
- Install the optional pre-commit guard:
  npm run install-hooks
