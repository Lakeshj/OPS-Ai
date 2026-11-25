/**
 * Perigon LinkedIn Social — public surface for OpsAi Native source wiring.
 */

const adapter = require("./adapter");
const connection = require("./connection");
const usage = require("./usage");
const constants = require("./constants");
const queryBuilder = require("./queryBuilder");
const mapResults = require("./mapResults");
const client = require("./client");
const errors = require("./errors");

module.exports = {
  id: constants.ADAPTER_ID,
  ...constants,
  ...adapter,
  testPerigonConnection: connection.testPerigonConnection,
  getUsageStatus: usage.getUsageStatus,
  buildSocialUsage: usage.buildSocialUsage,
  createPerigonClient: client.createPerigonClient,
  extractApiKey: client.extractApiKey,
  queryBuilder,
  mapResults,
  errors,
  CODE: errors.CODE,
};
