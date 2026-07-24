const express = require("express");
const { requireRole } = require("../../middleware/auth");
const { get, update } = require("./adminAiSettings.controller");

const router = express.Router();

router.use(requireRole("Admin"));
router.get("/", get);
router.put("/", update);

module.exports = router;
