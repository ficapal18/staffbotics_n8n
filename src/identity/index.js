// src/identity/index.js
const { normText, normId, normDate, buildPatientKey } = require("./normalize");
const { filenameContainsId, filenameMatchesName, tokens } = require("./matching");

module.exports = {
  normText,
  normId,
  normDate,
  buildPatientKey,
  filenameContainsId,
  filenameMatchesName,
  tokens
};
