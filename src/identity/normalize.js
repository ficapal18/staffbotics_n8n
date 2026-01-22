// src/normalize.js
const crypto = require("crypto");

function stripDiacritics(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normText(s) {
  return stripDiacritics(String(s ?? ""))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normId(s) {
  // normalize ids: remove spaces, keep alnum and basic separators
  const t = normText(s);
  return t.replace(/[^a-z0-9_-]/g, "");
}

function normDate(s) {
  // extremely defensive normalization: keep digits and separators; do not parse fully here
  const t = normText(s);
  if (!t) return "";
  return t.replace(/[^0-9/-]/g, "");
}

function sha1(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function buildPatientKey(ident = {}) {
  // Priority: patient_id > (name+dob) > name > fallback empty
  const pid = normId(ident.patient_id || "");
  const name = normText(ident.name || "");
  const dob = normDate(ident.dob || "");
  if (pid) return { patient_key: sha1(`pid:${pid}`), match_key_type: "patient_id" };
  if (name && dob) return { patient_key: sha1(`name_dob:${name}|${dob}`), match_key_type: "name_dob" };
  if (name) return { patient_key: sha1(`name:${name}`), match_key_type: "name" };
  return { patient_key: sha1(`unknown:${Math.random()}`), match_key_type: "unknown" };
}

module.exports = {
  normText,
  normId,
  normDate,
  buildPatientKey,
};
