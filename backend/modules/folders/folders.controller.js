const asyncHandler = require("../../utils/asyncHandler");
const foldersService = require("./folders.service");

const getAll = asyncHandler(async (req, res) => {
  res.json(await foldersService.getAll(req.user));
});

const getByWorkspaceId = asyncHandler(async (req, res) => {
  res.json(
    await foldersService.getByWorkspaceId(
      req.params.workspaceId,
      req.query.userId,
      req.user
    )
  );
});

const getById = asyncHandler(async (req, res) => {
  res.json(await foldersService.getById(req.params.id, req.user));
});

const create = asyncHandler(async (req, res) => {
  const folder = await foldersService.create(req.body, req.user);
  res.status(201).json(folder);
});

const update = asyncHandler(async (req, res) => {
  res.json(await foldersService.update(req.params.id, req.body, req.user));
});

const remove = asyncHandler(async (req, res) => {
  const result = await foldersService.remove(req.params.id, req.user);
  res.status(200).json(result);
});

module.exports = {
  getAll,
  getByWorkspaceId,
  getById,
  create,
  update,
  remove,
};
