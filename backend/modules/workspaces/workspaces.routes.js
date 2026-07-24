const express = require("express");
const validate = require("../../middleware/validate");
const { requireRole } = require("../../middleware/auth");
const {
  getAll,
  getById,
  create,
  update,
  remove,
} = require("./workspaces.controller");
const { validateCreateWorkspace } = require("./workspaces.validation");

const router = express.Router();

router.get("/", getAll);
router.get("/:id", getById);
router.post(
  "/",
  requireRole("Admin", "Project Manager"),
  validate(validateCreateWorkspace),
  create
);
router.put("/:id", requireRole("Admin", "Project Manager"), update);
router.delete("/:id", requireRole("Admin", "Project Manager"), remove);

module.exports = router;
