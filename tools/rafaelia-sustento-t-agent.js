/*
 * RAFAELIA SUSTENTO^T bounded receipt observer for Frida.
 *
 * Receipt metadata only. This agent does not attach hooks, call native
 * functions, spawn processes, execute shell commands, infer device execution,
 * or promote detector/quantum claims.
 */
rpc.exports = {
  observe(receiptJson) {
    const r = JSON.parse(receiptJson);
    if (r.schema !== "rafaelia.sustento-t-observation.receipt.v1")
      throw new Error("receipt schema mismatch");
    if (r.claim_allowed !== false || r.promotion_allowed !== false)
      throw new Error("claim/promotion forbidden");
    if (r.boundary !== "SOURCE!=ARTEFACT!=EXECUTION!=EVIDENCE!=CLAIM")
      throw new Error("boundary mismatch");
    if (!/^TOKEN_VAZIO/.test(r.physical_detector || ""))
      throw new Error("physical detector inference forbidden");
    if (!/^TOKEN_VAZIO/.test(r.quantum_causal_binding || ""))
      throw new Error("quantum causal inference forbidden");
    if (!/^TOKEN_VAZIO/.test(r.frida_physical_runtime || ""))
      throw new Error("physical Frida inference forbidden");
    if (!/^[0-9a-f]{64}$/.test(r.receipt_sha256 || ""))
      throw new Error("receipt digest malformed");

    const gate = r.gate || {};
    if (!["PASS", "HOLD", "TOKEN_VAZIO_GATE_INPUT"].includes(gate.state))
      throw new Error("unsupported gate state");

    return {
      schema: "rafaelia.frida.sustento-t-observer.event.v1",
      state: "OBSERVED_BOUNDED_RECEIPT",
      claim_allowed: false,
      promotion_allowed: false,
      physical_device: "TOKEN_VAZIO",
      gate_state: gate.state,
      diagnostic_gate_score: gate.score ?? null,
      score_semantics: "DIAGNOSTIC_AGGREGATOR_NOT_TRUTH_PROBABILITY",
      boundary: "OBSERVATION!=PHYSICAL_RUNTIME!=CLAIM"
    };
  }
};
