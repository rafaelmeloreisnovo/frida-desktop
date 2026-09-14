/*
 * RAFAELIA Matrix Compose receipt observer for Frida.
 *
 * This agent does not hook arbitrary functions or execute shell commands.
 * A host may call rpc.exports.observe(receiptJson) with an already produced
 * Matrix Compose V1 receipt. Returned data is bounded metadata only.
 */
rpc.exports = {
  observe(receiptJson) {
    const r = JSON.parse(receiptJson);
    if (r.schema !== "rafaelia.matrix-compose.receipt.v1")
      throw new Error("receipt schema mismatch");
    if (r.claim_allowed !== false)
      throw new Error("claim promotion forbidden");
    if (r.boundary !== "SOURCE!=EXECUTION!=EVIDENCE!=CLAIM")
      throw new Error("boundary mismatch");

    const digest = /^[0-9a-f]{64}$/;
    for (const key of ["source_spec_sha256", "ifdex_sha256", "packed_cell10_sha256"]) {
      if (!digest.test(r[key] || ""))
        throw new Error("invalid digest " + key);
    }

    return {
      schema: "rafaelia.frida.matrix-compose-observer.event.v1",
      state: "OBSERVED_RECEIPT",
      claim_allowed: false,
      physical_device: "TOKEN_VAZIO",
      shape: r.shape,
      operator: r.operator,
      boundary: "OBSERVATION!=PHYSICAL_RUNTIME!=CLAIM"
    };
  }
};
