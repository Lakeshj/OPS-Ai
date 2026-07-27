const asyncHandler = require("../../utils/asyncHandler");
const assistantsService = require("./assistants.service");
const { evaluateBotDesign } = require("../../services/botQuality.service");

const getAll = asyncHandler(async (req, res) => {
  res.json(await assistantsService.getAll());
});

const getById = asyncHandler(async (req, res) => {
  res.json(await assistantsService.getById(req.params.id));
});

const create = asyncHandler(async (req, res) => {
  const assistant = await assistantsService.create(req.body);
  res.status(201).json(assistant);
});

const update = asyncHandler(async (req, res) => {
  res.json(await assistantsService.update(req.params.id, req.body));
});

const remove = asyncHandler(async (req, res) => {
  await assistantsService.remove(req.params.id);
  res.status(204).send();
});

const evaluate = asyncHandler(async (req, res) => {
  res.json(await evaluateBotDesign(req.params.id));
});

module.exports = { getAll, getById, create, update, remove, evaluate };
