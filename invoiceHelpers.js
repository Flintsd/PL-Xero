// invoiceHelpers.js
// -----------------------------------------------------------------------------
// Helper functions for invoice creation:
//   - VAT → Xero TaxType mapping
//   - Branding theme selection (by customer category + isWeb)
//   - Brand tracking option for Xero Tracking
//   - Line item builder (from PL's order_detail.items)
//   - (Legacy) Invoice payload builder { Invoices: [ { ... } ] }
// -----------------------------------------------------------------------------
//
// NOTE: This module is *pure logic* and does not know about Express or Power
// Automate. It just takes JSON data and returns JSON structures that match what
// Xero expects.
// -----------------------------------------------------------------------------


// Optional config override
let CONFIG = {};
try {
  CONFIG = require("./config");
} catch (err) {
  CONFIG = {};
}

// Basic accounts
const XERO_SALES_ACCOUNT =
  CONFIG.XERO_SALES_ACCOUNT || process.env.XERO_SALES_ACCOUNT || "200";

const XERO_STRIPE_ACCOUNT =
  CONFIG.XERO_STRIPE_ACCOUNT || process.env.XERO_STRIPE_ACCOUNT || null;

// Branding theme IDs (from Xero → Settings → Invoice Settings → Branding)
const BRAND_EDINBURGH =
  CONFIG.XERO_BRAND_EDINBURGH || process.env.XERO_BRAND_EDINBURGH;
const BRAND_SDK = CONFIG.XERO_BRAND_SDK || process.env.XERO_BRAND_SDK;
const BRAND_GICLEE =
  CONFIG.XERO_BRAND_GICLEE || process.env.XERO_BRAND_GICLEE;
const BRAND_PPS = CONFIG.XERO_BRAND_PPS || process.env.XERO_BRAND_PPS;

// --------------------------- Tax helpers -----------------------------
// Map PL VAT rate (%) to Xero's taxType codes.
// Adjust the strings to match your Xero tax codes.

function mapVatToTaxType(vatRateStr) {
  const rate = parseFloat(vatRateStr || "0");
  if (isNaN(rate)) return "OUTPUT2"; // default 20%

  if (rate === 0) return "EXEMPTOUTPUT"; // Exempt / Zero-rated
  if (rate === 20) return "OUTPUT2"; // 20% VAT
  if (rate === 5) return "REDUCED"; // adjust if your 5% code differs

  // Default fallback
  return "OUTPUT2";
}

// --------------------------- Branding helpers ------------------------
// Decide brandingThemeId based on customer category or 'isWeb'.
// Full logic is in Power Automate – here we just pick the Xero Branding Theme.

function getBrandingThemeId({ categoryRaw, isWeb }) {
  const cat = (categoryRaw || "").toLowerCase();

  if (cat.includes("edinburgh banners") && BRAND_EDINBURGH) return BRAND_EDINBURGH;
  if (cat.includes("giclee") && BRAND_GICLEE) return BRAND_GICLEE;
  if (cat.includes("pro print") && BRAND_PPS) return BRAND_PPS;
  if (cat.includes("sdk") && BRAND_SDK) return BRAND_SDK;

  // Web orders default to Edinburgh Banners if set
  if (isWeb && BRAND_EDINBURGH) return BRAND_EDINBURGH;

  // If nothing matches, Xero will use its default branding
  return undefined;
}

// Decide tracking option for "Brand" tracking category in Xero
function getBrandTrackingOption({ categoryRaw, isWeb }) {
  const cat = (categoryRaw || "").toLowerCase();

  if (cat.includes("edinburgh banners")) return "Edinburgh Banners";
  if (cat.includes("giclee")) return "Giclee";
  if (cat.includes("pro print")) return "Pro Print Studio";
  if (cat.includes("sdk")) return "SDK Group";

  if (isWeb) return "Edinburgh Banners";

  return undefined;
}

// --------------------------- Line item builder -----------------------
// NEW SIGNATURE:
//
//   buildLineItems(plPayload, brandTrackingOption)
//
// Reads PL's order_detail.items which is usually an object:
//   { "1": { ... }, "2": { ... }, "3": { ... } }
// and converts it into an array of Xero lineItems.
//
// IMPORTANT – PRICING RULE:
// PL's item.price is treated as the *full line total (ex VAT)*,
// NOT "price per unit". We *ignore* quantity for the maths, but we
// still show the Qty in the description.
// Also: we DO NOT skip quantity=0 items (could be free shipping/services).

function buildLineItems(plPayload, brandTrackingOption) {
  const order_detail = plPayload?.order_detail;

  // If explicit lineItems were provided in the payload (future-proofing), trust them.
  if (Array.isArray(plPayload?.lineItems) && plPayload.lineItems.length > 0) {
    console.log("[invoiceHelpers.buildLineItems] Using lineItems from request.");
    return plPayload.lineItems;
  }

  if (!order_detail?.items || typeof order_detail.items !== "object") {
    console.log(
      "[invoiceHelpers.buildLineItems] order_detail.items not present or not an object – returning empty lineItems."
    );
    return [];
  }

  const itemsObj = order_detail.items;
  const keys = Object.keys(itemsObj);
  const xeroLineItems = [];

  keys.forEach((key) => {
    const item = itemsObj[key] || {};

    const qtyRaw = item.quantity ?? "1";
    const qty = parseFloat(qtyRaw);
    const lineTotal = parseFloat(item.price || "0") || 0; // treat as full line total

    const title = item.title || "Item";
    const detail = (item.detail || "").trim();

    const qtyText = !isNaN(qty) ? ` (Qty ${qty})` : "";
    const desc = title + qtyText + (detail ? ` - ${detail}` : "");

    const vatRateStr = item.vat || "0";
    const taxType = mapVatToTaxType(vatRateStr);

    // Optional tracking array for Xero
    const tracking =
      brandTrackingOption
        ? [
            {
              name: "Brand",
              option: brandTrackingOption,
            },
          ]
        : undefined;

    const line = {
      description: desc,
      quantity: 1, // full line total as a single unit
      unitAmount: lineTotal,
      accountCode: XERO_SALES_ACCOUNT,
      taxType,
    };

    if (tracking) {
      line.tracking = tracking;
    }

    xeroLineItems.push(line);
  });

  console.log(
    "[invoiceHelpers.buildLineItems] Built lineItems from order_detail.items (including qty=0 items):",
    xeroLineItems.length
  );
  return xeroLineItems;
}

// --------------------------- Legacy invoice payload builder ---------
// (Not used by the new invoiceService, but kept for backwards-compatibility)

function buildInvoicePayload({
  order_number,
  order_po,
  pl_order,
  order_detail,
  xeroLineItems,
  brandingThemeId,
}) {
  // --- Dates ---------------------------------------------------------
  const today = new Date();
  const isoDate = today.toISOString().slice(0, 10); // yyyy-mm-dd

  let dueDate = isoDate;
  if (order_detail?.order_date_due) {
    // Use PL due date if provided
    dueDate = order_detail.order_date_due;
  } else {
    // Fallback: +10 days
    const d = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);
    dueDate = d.toISOString().slice(0, 10);
  }

  // --- Reference field ------------------------------------------------
  const po = order_po ? String(order_po) : "";
  const job = order_number ? String(order_number) : "";
  let reference = "";

  if (po && job) reference = `${po} [${job}]`;
  else if (po) reference = po;
  else if (job) reference = `[${job}]`;

  // --- Contact info ---------------------------------------------------
  const customerName = pl_order?.customer_name;
  const orderContact = pl_order?.order_contact;
  const customerEmail =
    pl_order?.customer_email || order_detail?.order_contact_email || "";

  const contact = {
    name: customerName || orderContact || `Order ${order_number}`,
  };

  if (customerEmail) {
    contact.emailAddress = customerEmail;
  }

  // --- Invoice core ---------------------------------------------------
  const invoiceBody = {
    type: "ACCREC",
    contact,
    lineItems: xeroLineItems,
    date: isoDate,
    dueDate,
    reference,
    status: "AUTHORISED",
    lineAmountTypes: "Exclusive", // prices treated as net of VAT
  };

  if (brandingThemeId) {
    invoiceBody.brandingThemeID = brandingThemeId;
  }

  return {
    Invoices: [invoiceBody],
  };
}

module.exports = {
  XERO_SALES_ACCOUNT,
  XERO_STRIPE_ACCOUNT,
  mapVatToTaxType,
  getBrandingThemeId,
  getBrandTrackingOption,
  buildLineItems,
  buildInvoicePayload,
};
