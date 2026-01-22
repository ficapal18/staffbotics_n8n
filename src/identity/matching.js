// src/matching.js
const { normText, normId } = require("./normalize");

/**
 * Tokenize filename-like strings into safe tokens (alnum runs).
 */
function tokens(s) {
  const t = normText(s);
  if (!t) return [];
  return t.split(/[^a-z0-9]+/g).filter(Boolean);
}

/**
 * Boundary-safe check: does normalized filename contain id as a whole token
 * OR as a boundary-delimited substring (non-alnum around it).
 */
function filenameContainsId(filename, patientId) {
  const fid = normText(filename);
  const pid = normId(patientId);
  if (!pid) return false;

  const toks = tokens(fid);
  if (toks.includes(pid)) return true;

  // Boundary-delimited substring match (avoid 123 matching 1234)
  const re = new RegExp(`(^|[^a-z0-9])${pid}([^a-z0-9]|$)`, "i");
  return re.test(fid);
}

/**
 * Stronger name match:
 * - requires at least first token
 * - if last token exists, prefer (first+last) both present
 * - diacritics-insensitive via normalize()
 */
function filenameMatchesName(filename, name) {
  const fnToks = new Set(tokens(filename));
  const n = normText(name);
  if (!n) return false;

  const nameToks = n.split(" ").filter(Boolean);
  if (!nameToks.length) return false;

  const first = nameToks[0];
  const last = nameToks.length > 1 ? nameToks[nameToks.length - 1] : "";

  // Avoid super-common short tokens like "de", "la", "del"
  const stop = new Set(["de", "la", "del", "da", "do", "dos", "das", "van", "von"]);
  const firstOk = first.length >= 3 && !stop.has(first);

  if (!firstOk) return false;

  if (last && last.length >= 3 && !stop.has(last)) {
    return fnToks.has(first) && fnToks.has(last);
  }

  return fnToks.has(first);
}

module.exports = {
  filenameContainsId,
  filenameMatchesName,
  tokens,
};
