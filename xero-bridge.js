// xero-bridge.js
// -----------------------------------------------------------------------------
// Express API bridge between Power Automate / PrintLogic and Xero
// -----------------------------------------------------------------------------
//
// Routes:
//   GET  /                → simple "alive" message
//   GET  /health          → JSON health status
//   GET  /xero/auth-url   → returns Xero OAuth consent URL
//   GET  /xero/callback   → Xero redirects here after auth, saves token
//   POST /create-invoice  → main endpoint Power Automate calls
//   POST /xero/invoice-webhook → Xero → PL payment sync (when invoice is PAID)
// -----------------------------------------------------------------------------

require("dotenv").config();

const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const { PORT, LOG_LEVEL, PL_API_URL, PL_API_KEY } = require("./config");

// From xeroClient we just need the client + init helper
const { xero, initXeroFromDisk } = require("./xeroClient");

const { applyServerSideLogic } = require("./logicConfig");
const { createInvoiceFromPlPayload } = require("./invoiceService");

const app = express();

// Where we persist the Xero token set
const TOKEN_PATH = path.join(__dirname, "xero-token.json");

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Push an order status update back into PrintLogic.
 * Expects PL to respond with { result: "ok" } or { status: "ok" } on success.
 */
async function updatePrintlogicOrderStatus(orderNumber, status) {
  if (!PL_API_URL || !PL_API_KEY) {
    throw new Error("PL_API_URL or PL_API_KEY missing in environment");
  }

  const payload = {
    action: "update_order_status",
    order_number: String(orderNumber),
    status, // must exactly match PL status text e.g. "Pre-Press"
  };

  console.log("[PL] update_order_status payload:", payload);

  const resp = await axios.post(PL_API_URL, payload, {
    params: { api_key: PL_API_KEY },
    headers: { "Content-Type": "application/json" },
    timeout: 10000,
  });

  console.log("[PL] update_order_status response:", resp.data);

  const data = resp.data || {};

  // Accept either result:"ok" or status:"ok"
  const result = data.result ?? data.status;

  if (result !== "ok") {
    throw new Error(
      `PrintLogic update_order_status failed: ${JSON.stringify(data)}`
    );
  }

  return data;
}

/**
 * Extract PL order number from an invoice reference string.
 * Expected formats:
 *   "[6663]"
 *   "WEB-1532TEST [6662]"
 * Returns the numeric part as a string, or null if not found.
 */
function extractOrderNumberFromReference(ref) {
  if (!ref || typeof ref !== "string") return null;

  // Look for a [12345] pattern (e.g. "WEB-1532TEST [6662]" or "[6663]")
  const match = ref.match(/\[(\d+)\]/);
  if (match && match[1]) return match[1];

  // No bracketed order number found
  return null;
}

// -----------------------------------------------------------------------------
// Middleware
// -----------------------------------------------------------------------------

app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

// Simple logging: 'dev' if debug, else 'tiny'
app.use(morgan(LOG_LEVEL === "debug" ? "dev" : "tiny"));

// -----------------------------------------------------------------------------
// Basic routes
// -----------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.send("pl-xero bridge is running.");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "up",
    port: PORT,
    time: new Date().toISOString(),
  });
});

// -----------------------------------------------------------------------------
// Xero auth routes
// -----------------------------------------------------------------------------

// 1) Get Xero consent URL
app.get("/xero/auth-url", async (req, res) => {
  try {
    await xero.initialize();
    const consentUrl = await xero.buildConsentUrl();
    res.json({ ok: true, url: consentUrl });
  } catch (err) {
    console.error("[/xero/auth-url] Error:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Error building Xero auth URL",
    });
  }
});

// 2) Xero OAuth callback
app.get("/xero/callback", async (req, res) => {
  try {
    await xero.initialize();

    // xero-node's apiCallback parses the code + state from the URL
    const tokenSet = await xero.apiCallback(req.url);

    // Persist token so we can re-use it later (bridge restart, etc.)
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenSet, null, 2));
    console.log("[/xero/callback] Token saved to", TOKEN_PATH);

    // Update tenants so xeroClient knows the org
    await xero.updateTenants();

    console.log("[/xero/callback] Token saved and tenants updated.");

    res.send(
      "Xero authentication completed. You can close this window and run your Power Automate flow."
    );
  } catch (err) {
    console.error("[/xero/callback] Error:", err.response?.data || err);
    res
      .status(500)
      .send("Error completing Xero auth. Check server logs for details.");
  }
});

// -----------------------------------------------------------------------------
// Main invoice endpoint (PrintLogic → Xero)
// -----------------------------------------------------------------------------

app.post("/create-invoice", async (req, res) => {
  try {
    console.log("[/create-invoice] Incoming body:");
    console.log(JSON.stringify(req.body, null, 2));

    // Let logicConfig optionally tweak/inspect the payload
    const payload = applyServerSideLogic(req.body);

    // Optional escape hatch: allow logicConfig to set _skipXero
    if (payload._skipXero) {
      console.log("[/create-invoice] _skipXero flag set, not calling Xero.");
      return res.json({
        ok: true,
        skipped: true,
        reason: "_skipXero flag set by server-side logic",
      });
    }

    // The heavy lifting is done in invoiceService
    const result = await createInvoiceFromPlPayload(payload);

    return res.json({
      ok: true,
      result,
    });
  } catch (err) {
    console.error("[/create-invoice] Error:", err);

    // Try to surface useful details from Xero if present
    const status = err.response?.status || 500;
    const data = err.response?.data || err.response?.body;

    return res.status(status).json({
      ok: false,
      error: err.message || "Error creating invoice",
      xero: data || null,
    });
  }
});

// -----------------------------------------------------------------------------
// Xero → PrintLogic invoice webhook (payment sync)
// -----------------------------------------------------------------------------
//
// This endpoint is designed to be called by Xero webhooks when an invoice
// is updated. When an invoice transitions to PAID, we push the job back
// to PrintLogic and set it to "Pre-Press".
// Expected Xero-style payload:
//
// {
//   "events": [
//     {
//       "eventCategory": "INVOICE",
//       "eventType": "UPDATE",
//       "resourceId": "00000000-0000-0000-0000-000000000000"
//     }
//   ]
// }
//
app.post("/xero/invoice-webhook", async (req, res) => {
  try {
    const events = req.body?.events || [];

    if (!Array.isArray(events) || events.length === 0) {
      console.log("[/xero/invoice-webhook] No events in payload");
      return res.status(200).send("No events");
    }

    // Ensure Xero client is ready & we know tenant
    await xero.initialize();
    await xero.updateTenants();

    const tenantId =
      process.env.XERO_TENANT_ID ||
      (Array.isArray(xero.tenants) && xero.tenants[0]?.tenantId);

    if (!tenantId) {
      throw new Error("No Xero tenantId available");
    }

    for (const event of events) {
      // We only care about invoice updates
      if (event.eventCategory !== "INVOICE" || event.eventType !== "UPDATE") {
        continue;
      }

      const resourceId = event.resourceId;
      if (!resourceId) continue;

      // Ignore Xero's sample placeholder
      if (resourceId === "PAID_INVOICE_ID_GOES_HERE") {
        console.log(
          "[/xero/invoice-webhook] Ignoring placeholder resourceId PAID_INVOICE_ID_GOES_HERE"
        );
        continue;
      }

      console.log(
        `[/xero/invoice-webhook] Processing invoice event for resourceId: ${resourceId}`
      );

      const { body } = await xero.accountingApi.getInvoice(tenantId, resourceId);
      const invoice = body?.invoices?.[0];

      if (!invoice) {
        console.warn(
          `[/xero/invoice-webhook] No invoice returned for resourceId: ${resourceId}`
        );
        continue;
      }

      console.log(
        `[/xero/invoice-webhook] Invoice ${invoice.invoiceNumber} status: ${invoice.status}`
      );

      // Only push back to PL when invoice is PAID
      if (invoice.status !== "PAID") {
        continue;
      }

      // Extract PL order number from invoice.reference (e.g. "WEB-1532TEST [6662]")
      const plOrderNumber = extractOrderNumberFromReference(invoice.reference);

      if (!plOrderNumber) {
        console.warn(
          `[/xero/invoice-webhook] Could not extract PL order number from reference: ${invoice.reference}`
        );
        continue;
      }

      // Update the order in PrintLogic to Pre-Press
      await updatePrintlogicOrderStatus(plOrderNumber, "Pre-Press");

      console.log(
        `[/xero/invoice-webhook] Updated PL order ${plOrderNumber} → "Pre-Press" (Xero invoice ${invoice.invoiceNumber})`
      );
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error(
      "[/xero/invoice-webhook] Error:",
      // xero-node puts the HTTP body on `response.body`
      err.response?.body || err.message || err
    );
    res.status(500).send("Error handling invoice webhook");
  }
});

// -----------------------------------------------------------------------------
// Fallback error handler
// -----------------------------------------------------------------------------

app.use((err, req, res, next) => {
  console.error("[pl-xero] Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

// -----------------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[pl-xero] Server listening on port ${PORT}`);

  // Optionally initialise Xero from any saved token on startup
  initXeroFromDisk().catch((err) => {
    console.error("[pl-xero] initXeroFromDisk error:", err);
  });
});
