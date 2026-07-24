const express = require("express");
const validate = require("../../middleware/validate");
const { requireRole } = require("../../middleware/auth");
const {
  getAll,
  getById,
  create,
  update,
  remove,
} = require("./assistants.controller");
const { validateCreateAssistant, validateUpdateAssistant } = require("./assistants.validation");

const router = express.Router();

router.get("/", getAll);
router.get("/:id", getById);
router.post(
  "/",
  requireRole("Admin"),
  validate(validateCreateAssistant),
  create
);
router.put(
  "/:id",
  requireRole("Admin"),
  validate(validateUpdateAssistant),
  update
);
router.delete("/:id", requireRole("Admin"), remove);

module.exports = router;
