const express = require("express");
const validate = require("../../middleware/validate");
const {
  getAll,
  getById,
  create,
  update,
  remove,
} = require("./chatThreads.controller");
const { validateCreateThread } = require("./chatThreads.validation");

const router = express.Router();

router.get("/", getAll);
router.get("/:id", getById);
router.post("/", validate(validateCreateThread), create);
router.put("/:id", update);
router.delete("/:id", remove);

module.exports = router;
