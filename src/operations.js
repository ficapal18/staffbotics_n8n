// src/operations.js
// LLM usage: applyOperations(patientCandidates, operations, userInstruction) -> { patientCandidates, operationsApplied, userInstruction }
/**
 * Apply a list of operations (merge, reassign, change_strategy) over patientCandidates.
 *
 * @param {Array} patientCandidates
 * @param {Array} operations - list of { op: string, params: any }
 * @param {string} userInstruction
 *
 * Returns: { patientCandidates, operationsApplied, userInstruction }
 */
function applyOperations(patientCandidates = [], operations = [], userInstruction = "") {
    const pcById = {};
    patientCandidates.forEach((pc) => {
      pcById[pc.candidate_id] = pc;
    });
  
    function applyMerge(params) {
      const from = params.from || [];
      const into = params.into;
      if (!into || !pcById[into]) return;
      const dst = pcById[into];
  
      from.forEach((sid) => {
        if (sid === into) return;
        const src = pcById[sid];
        if (!src) return;
        const srcItems = src.raw_items || [];
        dst.raw_items = (dst.raw_items || []).concat(srcItems);
        src.raw_items = [];
        src.notes = (src.notes || []).concat(`Merged into ${into}`);
        src.confidence = 0.0;
      });
    }
  
    function applyReassign(params) {
      const rid = params.raw_item_id;
      const newCid = params.new_candidate;
      if (!rid || !pcById[newCid]) return;
  
      // Remove from all candidates
      patientCandidates.forEach((pc) => {
        const ris = pc.raw_items || [];
        pc.raw_items = ris.filter((ri) => ri.id !== rid);
      });
  
      // We assume the rawItem still exists globally and could be looked up.
      // Here, we push a stub to mark that it was reassigned.
      const target = pcById[newCid];
      target.raw_items = target.raw_items || [];
      target.raw_items.push({
        id: rid,
        source_type: "unknown",
        source_ref: "reassigned",
        metadata: {}
      });
    }
  
    function applyChangeStrategy(params) {
      const newStrategy = params.unit_strategy;
      if (!newStrategy) return;
      patientCandidates.forEach((pc) => {
        pc.notes = pc.notes || [];
        pc.notes.push(
          `User requested strategy change to ${newStrategy} (not auto-applied in this step).`
        );
      });
    }
  
    operations.forEach((op) => {
      const opType = op.op;
      const params = op.params || {};
      if (opType === "merge") applyMerge(params);
      else if (opType === "reassign") applyReassign(params);
      else if (opType === "change_strategy") applyChangeStrategy(params);
    });
  
    return {
      patientCandidates,
      operationsApplied: operations,
      userInstruction
    };
  }
  
  module.exports = {
    applyOperations
  };
  