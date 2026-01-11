// invoiceService.js

const { xero, ensureXeroReady } = require("./xeroClient");
const { buildLineItems } = require("./invoiceHelpers");

function toBool(val) {
  if (typeof val === "boolean") return val;
  if (val == null) return false;
  const s = String(val).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

/**
 * Derive all the “context” we need for the invoice
 * from the incoming Power Automate / PrintLogic payload.
 */
function deriveContext(payload) {
  const {
    template,
    logicSource,
    order_po,
    pl_order = {},
    markAsPaid,
    emailCustomer,
  } = payload;

  const isWebOrder = !!(order_po && order_po.startsWith("WEB-"));

  // Brand / template → branding theme
  let brandingThemeId = undefined;
  let customerCategory = pl_order.customer_category || "";
  let brandTrackingOption = undefined;

  const tpl = template || customerCategory || "";

  if (tpl === "Edinburgh_Banners") {
    brandingThemeId = process.env.XERO_BRAND_EDINBURGH || undefined;
    customerCategory = "Edinburgh_Banners";
    brandTrackingOption = "Edinburgh Banners";
  } else {
    // fall back – you can expand this switch as you add brands
    customerCategory = customerCategory || tpl || "Default";
    brandTrackingOption = tpl || "Default";
  }

  const markAsPaidFlag = toBool(markAsPaid);
  const emailCustomerFlag = toBool(emailCustomer);

  const XERO_STRIPE_ACCOUNT =
    process.env.XERO_STRIPE_ACCOUNT ||
    process.env.XERO_STRIPE_ACCOUNT_CODE ||
    "0002";

  const context = {
    template: tpl,
    logicSource: logicSource || "",
    isWebOrder,
    customerCategory,
    brandingThemeId,
    brandTrackingOption,
    markAsPaidFlag,
    emailCustomerFlag,
    XERO_STRIPE_ACCOUNT,
  };

  console.log("[invoiceService] derived values:", JSON.stringify(context, null, 2));

  return context;
}

/**
 * Build the Xero Invoice object from the incoming payload
 * and derived context.
 */
function buildInvoiceModel(payload, context) {
  const { order_number, order_po, pl_order = {}, order_detail = {} } = payload;
  const { brandingThemeId, brandTrackingOption } = context;

  const todayIso = new Date().toISOString().slice(0, 10);

  const contactName =
    pl_order.customer_name ||
    order_detail.customer_name ||
    pl_order.order_contact ||
    order_detail.order_contact ||
    "Unknown Customer";

  const contactEmail =
    pl_order.customer_email ||
    pl_order.order_contact_email ||
    order_detail.order_contact_email ||
    order_detail.customer_email ||
    undefined;

  const dueDate =
    order_detail.order_date_due && order_detail.order_date_due !== "0000-00-00"
      ? order_detail.order_date_due
      : todayIso;

  const referenceParts = [];
  if (order_po) referenceParts.push(order_po);
  if (order_number) referenceParts.push(`[${order_number}]`);
  const reference = referenceParts.join(" ");

  // Build line items from the full PL payload so invoiceHelpers
  // can find order_detail.items itself
  const lineItems = buildLineItems(payload, brandTrackingOption);
  console.log("[invoiceService] lineItems length:", lineItems.length);

  const invoice = {
    type: "ACCREC",
    contact: {
      name: contactName,
    },
    lineItems,
    date: todayIso,
    dueDate,
    reference,
    status: "AUTHORISED",
    lineAmountTypes: "Exclusive",
  };

  if (contactEmail) {
    invoice.contact.emailAddress = contactEmail;
  }

  if (brandingThemeId) {
    invoice.brandingThemeID = brandingThemeId;
  }

  console.log(
    "[invoiceService] Xero invoice model:",
    JSON.stringify(invoice, null, 2)
  );

  return invoice;
}

/**
 * Optionally mark the invoice as paid in Xero using createPayments.
 */
async function maybeMarkAsPaid(
  xeroClient,
  xeroTenantId,
  payload,
  context,
  createdInvoice
) {
  if (!context.markAsPaidFlag) {
    return;
  }

  if (!createdInvoice || !createdInvoice.invoiceID) {
    console.warn(
      "[invoiceService] markAsPaid requested but no invoiceID returned from Xero"
    );
    return;
  }

  const { pl_order = {}, order_detail = {} } = payload;

  const totalIncVatStr =
    pl_order.order_tot_incvat ||
    (pl_order.order_total && pl_order.order_vat
      ? (
          parseFloat(pl_order.order_total || "0") +
          parseFloat(pl_order.order_vat || "0")
        ).toFixed(2)
      : null) ||
    (order_detail.order_total && order_detail.order_vat
      ? (
          parseFloat(order_detail.order_total || "0") +
          parseFloat(order_detail.order_vat || "0")
        ).toFixed(2)
      : null);

  const amount = totalIncVatStr ? parseFloat(totalIncVatStr) : null;

  if (!amount || isNaN(amount)) {
    console.warn(
      "[invoiceService] markAsPaid requested but could not determine amount, skipping payment."
    );
    return;
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  const payment = {
    payments: [
      {
        invoice: {
          invoiceID: createdInvoice.invoiceID,
        },
        account: {
          code: context.XERO_STRIPE_ACCOUNT,
        },
        date: todayIso,
        amount,
      },
    ],
  };

  console.log(
    "[invoiceService] Creating payment to mark invoice as paid:",
    JSON.stringify(payment, null, 2)
  );

  try {
    const response = await xeroClient.accountingApi.createPayments(
      xeroTenantId,
      payment,
      true // summarizeErrors
    );
    console.log(
      "[invoiceService] createPayments response:",
      JSON.stringify(response.body || response.response?.statusCode, null, 2)
    );
  } catch (err) {
    const errorJson = err?.response?.body
      ? JSON.stringify(err.response.body, null, 2)
      : err.message;
    console.error("[invoiceService] Error creating payment:", errorJson);
  }
}

/**
 * Optionally email the invoice to the customer.
 */
async function maybeEmailInvoice(
  xeroClient,
  xeroTenantId,
  context,
  createdInvoice
) {
  if (!context.emailCustomerFlag) return;
  if (!createdInvoice || !createdInvoice.invoiceID) {
    console.warn(
      "[invoiceService] emailCustomer requested but no invoiceID returned from Xero"
    );
    return;
  }

  console.log(
    `[invoiceService] Emailing invoice ${createdInvoice.invoiceID} to customer`
  );

  try {
    // emailInvoice expects an empty object as body
    const requestEmpty = {};
    const response = await xeroClient.accountingApi.emailInvoice(
      xeroTenantId,
      createdInvoice.invoiceID,
      requestEmpty
    );
    console.log(
      "[invoiceService] emailInvoice response:",
      JSON.stringify(response.body || response.response?.statusCode, null, 2)
    );
  } catch (err) {
    const errorJson = err?.response?.body
      ? JSON.stringify(err.response.body, null, 2)
      : err.message;
    console.error("[invoiceService] Error emailing invoice:", errorJson);
  }
}

/**
 * Main entry point called from xero-bridge.js
 * with the body from Power Automate / PrintLogic.
 */
async function createInvoiceFromPlPayload(plPayload) {
  console.log(
    "[invoiceService.createInvoiceFromPlPayload] - incoming payload:\n",
    JSON.stringify(plPayload, null, 2)
  );

  const context = deriveContext(plPayload);

  const invoice = buildInvoiceModel(plPayload, context);

  // Structure the payload the Xero SDK expects:
  // { invoices: [ invoice ] }
  const invoicesWrapper = { invoices: [invoice] };

  const xeroTenantId = await ensureXeroReady();

  console.log("[invoiceService] Calling createInvoices with payload:");
  console.log(JSON.stringify(invoicesWrapper, null, 2));

  try {
    const summarizeErrors = true;
    const unitdp = 2;

    const result = await xero.accountingApi.createInvoices(
      xeroTenantId,
      invoicesWrapper,
      summarizeErrors,
      unitdp
    );

    const createdInvoice =
      result?.body?.invoices && result.body.invoices.length
        ? result.body.invoices[0]
        : null;

    console.log(
      "[invoiceService] createInvoices response:",
      JSON.stringify(result.body || result.response?.statusCode, null, 2)
    );

    // Mark as paid, if requested
    await maybeMarkAsPaid(xero, xeroTenantId, plPayload, context, createdInvoice);

    // Email customer, if requested
    await maybeEmailInvoice(xero, xeroTenantId, context, createdInvoice);

    return {
      success: true,
      invoice: createdInvoice,
      rawResponse: result.body || null,
    };
  } catch (err) {
    const errorJson = err?.response?.body
      ? JSON.stringify(err.response.body, null, 2)
      : err.message;

    console.error("[/create-invoice] Error in invoiceService:", errorJson);

    return {
      success: false,
      error: errorJson,
    };
  }
}

module.exports = {
  createInvoiceFromPlPayload,
};
