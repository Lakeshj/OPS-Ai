const asyncHandler = require("../../utils/asyncHandler");
const usersService = require("./users.service");

const getAll = asyncHandler(async (req, res) => {
  res.json(await usersService.getAll());
});

const getById = asyncHandler(async (req, res) => {
  res.json(await usersService.getById(req.params.id));
});

const create = asyncHandler(async (req, res) => {
  const user = await usersService.create(req.body);
  res.status(201).json(user);
});

const update = asyncHandler(async (req, res) => {
  res.json(await usersService.update(req.params.id, req.body));
});

const remove = asyncHandler(async (req, res) => {
  await usersService.remove(req.params.id);
  res.status(204).send();
});

module.exports = { getAll, getById, create, update, remove };
