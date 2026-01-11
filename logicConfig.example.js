// logicConfig.example.js
// -----------------------------------------------------------------------------
// Example logic hook. Copy to logicConfig.js if you want local overrides.
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

  // Example: inspect the request without mutating it.
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

  return payload;
}

module.exports = {
  applyServerSideLogic,
};
