const express = require("express");
const { requireRole } = require("../../middleware/auth");
const { list, remove, purge } = require("./adminGeneratedMedia.controller");

const router = express.Router();

router.use(requireRole("Admin"));
router.get("/", list);
router.delete("/purge", purge);
router.delete("/:filename", remove);

module.exports = router;
