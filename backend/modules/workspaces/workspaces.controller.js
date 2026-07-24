const asyncHandler = require("../../utils/asyncHandler");
const workspacesService = require("./workspaces.service");

const getAll = asyncHandler(async (req, res) => {
  res.json(await workspacesService.getAll(req.user));
});

const getById = asyncHandler(async (req, res) => {
  res.json(await workspacesService.getById(req.params.id, req.user));
});

const getByUserId = asyncHandler(async (req, res) => {
  res.json(
    await workspacesService.getByUserId(req.params.userId, req.user)
  );
});

const create = asyncHandler(async (req, res) => {
  const payload = {
    ...req.body,
    createdBy: req.user.userId,
  };
  const workspace = await workspacesService.create(payload);
  res.status(201).json(workspace);
});

const update = asyncHandler(async (req, res) => {
  res.json(await workspacesService.update(req.params.id, req.body, req.user));
});

const remove = asyncHandler(async (req, res) => {
  const result = await workspacesService.remove(req.params.id, req.user);
  res.json(result);
});

module.exports = { getAll, getById, getByUserId, create, update, remove };
