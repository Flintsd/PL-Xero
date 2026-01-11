// xeroClient.js
// Centralised Xero client, with manual refresh + tenant handling

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { XeroClient } = require("xero-node");

const TOKEN_PATH = path.join(__dirname, "xero-token.json");

const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [process.env.XERO_REDIRECT_URI],
  scopes: (process.env.XERO_SCOPES || "").split(" "),
});

let tenantId = process.env.XERO_TENANT_ID || null;

// ---------- helpers ----------

function hasValidRefresh(tokenSet) {
  return (
    tokenSet &&
    typeof tokenSet.refresh_token === "string" &&
    tokenSet.refresh_token.length > 0
  );
}

function isTokenExpiredLocal(tokenSet) {
  if (!tokenSet || !tokenSet.expires_at) return false; // if we can't tell, assume OK
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec >= tokenSet.expires_at;
}

function saveToken(tokenSet) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenSet, null, 2));
  console.log("[Xero] Saved token to", TOKEN_PATH);
}

// Manual refresh against Xero's OAuth2 token endpoint (no use of xero.openIdClient)
async function refreshWithAxios(tokenSet) {
  if (!hasValidRefresh(tokenSet)) {
    throw new Error("No refresh_token present in token set.");
  }

  console.log("[Xero] Refreshing token via Xero identity endpoint...");

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", tokenSet.refresh_token);
  params.append("client_id", process.env.XERO_CLIENT_ID);
  params.append("client_secret", process.env.XERO_CLIENT_SECRET);

  const resp = await axios.post(
    "https://identity.xero.com/connect/token",
    params.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 10000,
    }
  );

  const data = resp.data;
  const nowSec = Math.floor(Date.now() / 1000);

  // Build a new tokenSet compatible with xero-node
  const newTokenSet = {
    // keep anything else we previously had (id_token, session_state, etc.)
    ...tokenSet,
    ...data, // access_token, refresh_token, expires_in, id_token?, scope, token_type
    expires_at: nowSec + (data.expires_in || 1800), // default 30 minutes if not provided
  };

  await xero.setTokenSet(newTokenSet);
  saveToken(newTokenSet);

  console.log("[Xero] Token refreshed. New expiry (epoch):", newTokenSet.expires_at);
  return newTokenSet;
}

// ---------- init from disk (best effort) ----------

async function initFromSavedToken() {
  if (!fs.existsSync(TOKEN_PATH)) {
    console.log("[Xero] No saved token found.");
    return;
  }

  try {
    const storedToken = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

    // Make sure XeroClient is initialized
    try {
      await xero.initialize();
    } catch (e) {
      // initialize() is idempotent, ignore errors if it's already initialised
      console.log("[Xero] initialize() during initFromSavedToken:", e.message || e);
    }

    await xero.setTokenSet(storedToken);

    if (isTokenExpiredLocal(storedToken)) {
      console.log(
        "[Xero] Token from disk appears expired, will refresh on next request."
      );
      return;
    }

    let connections = [];
    try {
      connections = await xero.updateTenants();
    } catch (err) {
      console.error(
        "[Xero] Error updating tenants during init:",
        err.response?.data || err.message || err
      );
      connections = [];
    }

    if (connections.length > 0) {
      tenantId = connections[0].tenantId;
      console.log("[Xero] Initialised. Tenant:", tenantId);
    } else {
      console.log("[Xero] No tenants attached on init.");
    }
  } catch (err) {
    console.error("[Xero] Error initialising from disk token:", err);
  }
}

// Backwards-compatible name used in xero-bridge.js
async function initXeroFromDisk() {
  return initFromSavedToken();
}

// ---------- ensure-ready for requests ----------

async function ensureXeroReady() {
  console.log("[Xero] ensureXeroReady: tenantId BEFORE:", tenantId);

  // Make sure the client is initialised
  try {
    await xero.initialize();
  } catch (e) {
    console.log("[Xero] initialize() in ensureXeroReady:", e.message || e);
  }

  let tokenSet = null;

  // Try to read current token set from the XeroClient
  try {
    tokenSet = await xero.readTokenSet();
  } catch (e) {
    tokenSet = null;
  }

  // Nothing useful in memory? Try loading from disk
  if (!hasValidRefresh(tokenSet)) {
    if (fs.existsSync(TOKEN_PATH)) {
      try {
        const stored = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
        await xero.setTokenSet(stored);
        tokenSet = stored;
        console.log("[Xero] Loaded token set from disk in ensureXeroReady.");
      } catch (e) {
        console.error(
          "[Xero] Failed to load token from disk in ensureXeroReady:",
          e.message || e
        );
      }
    }
  }

  if (!hasValidRefresh(tokenSet)) {
    throw new Error(
      "No Xero refresh token available. Re-authenticate Xero via the connect endpoint."
    );
  }

  // ALWAYS refresh once before calling Xero APIs to avoid 401s on stale access tokens
  try {
    tokenSet = await refreshWithAxios(tokenSet);
  } catch (err) {
    console.error(
      "[Xero] Failed to refresh token:",
      err.response?.data || err.message || err
    );
    throw new Error(
      "Failed to refresh Xero token. You may need to re-connect Xero via the browser auth flow."
    );
  }

  // Ensure we have a tenantId
  let conns = [];
  try {
    conns = await xero.updateTenants();
  } catch (err) {
    console.error(
      "[Xero] Error updating tenants after refresh:",
      err.response?.data || err.message || err
    );
    throw new Error("Failed to fetch Xero tenants after token refresh.");
  }

  if (conns.length === 0) {
    throw new Error("No Xero tenants available. Check the Xero org connection.");
  }

  tenantId = conns[0].tenantId;
  console.log("[Xero] ensureXeroReady: tenantId AFTER:", tenantId);
  return tenantId;
}

function getTenantId() {
  return tenantId;
}

module.exports = {
  xero,
  ensureXeroReady,
  getTenantId,
  initXeroFromDisk,
};
