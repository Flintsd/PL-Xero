// config.example.js
// -----------------------------------------------------------------------------
// Example config shape (values here are placeholders).
// Real values must be provided via environment variables.
// -----------------------------------------------------------------------------

module.exports = {
  // Basic app settings
  PORT: 4002,
  LOG_LEVEL: "info", // "debug" | "info" | "warn" | "error"

  // Xero OAuth settings
  XERO_CLIENT_ID: "your-xero-client-id",
  XERO_CLIENT_SECRET: "your-xero-client-secret",
  XERO_REDIRECT_URI: "https://your-domain.example.com/xero/callback",
  XERO_SCOPES:
    "offline_access accounting.transactions accounting.contacts accounting.settings",

  // Where we store the Xero token JSON
  TOKEN_PATH: "./xero-token.json",

  // Accounting config
  XERO_SALES_ACCOUNT: "200",

  // Stripe / online payment clearing account
  XERO_STRIPE_ACCOUNT: null,

  // Tenant (OPTIONAL - leave null if you want to auto-select the first tenant)
  XERO_TENANT_ID: null,

  // Branding theme IDs (from Xero -> Settings -> Invoice Settings)
  BRAND_EDINBURGH: null,
  BRAND_SDK: null,
  BRAND_GICLEE: null,
  BRAND_PPS: null,

  // PrintLogic API config
  PL_API_URL: "https://www.printlogicsystem.com/api.php",
  PL_API_KEY: null,
};
