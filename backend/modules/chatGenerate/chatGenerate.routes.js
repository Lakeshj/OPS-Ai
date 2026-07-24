const express = require("express");
const validate = require("../../middleware/validate");
const { generate } = require("./chatGenerate.controller");
const { validateGenerate } = require("./chatGenerate.validation");

const router = express.Router();

router.post("/generate", validate(validateGenerate), generate);

module.exports = router;
