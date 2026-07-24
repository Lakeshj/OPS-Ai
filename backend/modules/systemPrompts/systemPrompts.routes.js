const express = require("express");
const { requireRole } = require("../../middleware/auth");
const {
  getUseCases,
  getAll,
  getById,
  create,
  update,
  remove,
} = require("./systemPrompts.controller");

const router = express.Router();

router.use(requireRole("Admin"));
router.get("/use-cases", getUseCases);
router.get("/", getAll);
router.get("/:id", getById);
router.post("/", create);
router.put("/:id", update);
router.delete("/:id", remove);

module.exports = router;
