// logicConfig.js
// -----------------------------------------------------------------------------
// Node-side logic layer
//
// At the moment, ALL real "business logic" (who gets what template, mark-as-paid,
// email-yes/no, etc.) is controlled in Power Automate.
//
// This module is just a hook that lets you *optionally* tweak or inspect the
// payload before we send it to invoiceService. Right now it simply logs and
// returns the payload unchanged.
// -----------------------------------------------------------------------------

/**
 * Apply any server-side overrides to the PA payload.
 * For now this is a no-op (pass-through).
 *
 * @param {object} rawPayload - body received from Power Automate
 * @returns {object} - payload (possibly modified)
 */
function applyServerSideLogic(rawPayload) {
  const payload = { ...(rawPayload || {}) };

  // Light logging so you can see what PA decided
  console.log(
    "[logicConfig] logicSource:",
    payload.logicSource || null,
    "| template:",
    payload.template || null,
    "| markAsPaid:",
    payload.markAsPaid,
    "| emailCustomer:",
    payload.emailCustomer
  );

  // EXAMPLES of what you *could* do here later:
  //
  // 1) Block test orders from going to Xero:
  // if (payload.order_desc && payload.order_desc.toLowerCase().includes("test")) {
  //   payload._skipXero = true;
  // }
  //
  // 2) Override template for a special customer:
  // if (payload.customer_name === "Very Special Client Ltd") {
  //   payload.template = "SDK_Group";
  // }
  //
  // For now we don't change anything – PA is the source of truth.
  return payload;
}

module.exports = {
  applyServerSideLogic,
};
