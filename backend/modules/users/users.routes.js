const express = require("express");
const validate = require("../../middleware/validate");
const { requireRole } = require("../../middleware/auth");
const {
  getAll,
  getById,
  create,
  update,
  remove,
} = require("./users.controller");
const { validateCreateUser, validateUpdateUser } = require("./users.validation");

const router = express.Router();

router.get("/", requireRole("Admin", "Project Manager"), getAll);
router.get("/:id", requireRole("Admin", "Project Manager"), getById);
router.post("/", requireRole("Admin"), validate(validateCreateUser), create);
router.put("/:id", requireRole("Admin"), validate(validateUpdateUser), update);
router.delete("/:id", requireRole("Admin"), remove);

module.exports = router;
