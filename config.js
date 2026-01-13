// config.js
// -----------------------------------------------------------------------------
// Central config wrapper around process.env
// -----------------------------------------------------------------------------

// Load environment from /etc/pl-xero/pl-xero.env (server-managed config)
try {
  require("dotenv").config({ path: "/etc/pl-xero/pl-xero.env" });
} catch (e) {
  // If dotenv isn't installed yet, config will still work with PM2-provided env.
}

const path = require("path");

module.exports = {
  // Basic app settings
  PORT: process.env.PORT || 4002,
  LOG_LEVEL: process.env.LOG_LEVEL || "info", // "debug" | "info" | "warn" | "error"

  // Xero OAuth settings (must be set in .env)
  XERO_CLIENT_ID: process.env.XERO_CLIENT_ID,
  XERO_CLIENT_SECRET: process.env.XERO_CLIENT_SECRET,
  XERO_REDIRECT_URI: process.env.XERO_REDIRECT_URI,
  XERO_SCOPES:
    process.env.XERO_SCOPES ||
    "offline_access accounting.transactions accounting.contacts accounting.settings",

  // Where we store the Xero token JSON
  TOKEN_PATH: "/var/lib/pl-xero/xero-token.json",

  // Accounting config
  XERO_SALES_ACCOUNT: process.env.XERO_SALES_ACCOUNT || "200",

  // Stripe / online payment clearing account
  XERO_STRIPE_ACCOUNT: process.env.XERO_STRIPE_ACCOUNT || null,

  // Tenant (OPTIONAL — leave null if you want to auto-select the first tenant)
  XERO_TENANT_ID: process.env.XERO_TENANT_ID || null,

  // Branding theme IDs (from Xero → Settings → Invoice Settings)
  BRAND_EDINBURGH: process.env.XERO_BRAND_EDINBURGH || null,
  BRAND_SDK: process.env.XERO_BRAND_SDK || null,
  BRAND_GICLEE: process.env.XERO_BRAND_GICLEE || null,
  BRAND_PPS: process.env.XERO_BRAND_PPS || null,

  // PrintLogic API config
  PL_API_URL:
    process.env.PL_API_URL || "https://www.printlogicsystem.com/api.php",
  PL_API_KEY: process.env.PL_API_KEY || null,
};
