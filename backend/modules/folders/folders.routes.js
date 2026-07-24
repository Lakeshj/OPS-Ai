const express = require("express");
const validate = require("../../middleware/validate");
const {
  getAll,
  getById,
  create,
  update,
  remove,
} = require("./folders.controller");
const { validateCreateFolder } = require("./folders.validation");

const router = express.Router();

router.get("/", getAll);
router.get("/:id", getById);
router.post("/", validate(validateCreateFolder), create);
router.put("/:id", update);
router.delete("/:id", remove);

module.exports = router;
