const express = require("express");
const validate = require("../../middleware/validate");
const {
  getAll,
  getById,
  create,
  update,
  remove,
} = require("./chatMessages.controller");
const { validateCreateMessage } = require("./chatMessages.validation");

const router = express.Router();

router.get("/", getAll);
router.get("/:id", getById);
router.post("/", validate(validateCreateMessage), create);
router.put("/:id", update);
router.delete("/:id", remove);

module.exports = router;
