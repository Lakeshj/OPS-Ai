/**
 * OpsAi Native LinkedIn Lead Discovery provider.
 * M10.1: fixtures. M10.2: permitted live collection engine (authorized feed + user dataset).
 * Independent of Apify.
 */

const engine = require("./nativeCollection/engine");
const { getNativeCollectionConfig } = require("./nativeCollection/config");

const search = async (spec = {}) => engine.search(spec);

const getPostDetails = async (spec = {}) => engine.getPostDetails(spec);

const getUsageStatus = async () => ({
  available: false,
  reason: "OpsAi Native does not expose Free/Paid Apify-style usage quotas.",
  free: null,
  paid: null,
});

const getStatus = (overrides) => engine.getNativeStatus(overrides);

module.exports = {
  id: "opsai_native",
  FIXTURE_POSTS: engine.FIXTURE_POSTS,
  search,
  getPostDetails,
  getUsageStatus,
  getStatus,
  getNativeCollectionConfig,
};
