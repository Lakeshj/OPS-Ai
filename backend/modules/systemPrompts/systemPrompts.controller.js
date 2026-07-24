const asyncHandler = require("../../utils/asyncHandler");
const service = require("./systemPrompts.service");

const getUseCases = asyncHandler(async (_req, res) => {
  res.json(service.listUseCases());
});

const getAll = asyncHandler(async (_req, res) => {
  res.json(await service.getAll());
});

const getById = asyncHandler(async (req, res) => {
  res.json(await service.getById(req.params.id));
});

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await service.create(req.body || {}, req.user));
});

const update = asyncHandler(async (req, res) => {
  res.json(await service.update(req.params.id, req.body || {}));
});

const remove = asyncHandler(async (req, res) => {
  res.json(await service.remove(req.params.id));
});

module.exports = { getUseCases, getAll, getById, create, update, remove };
