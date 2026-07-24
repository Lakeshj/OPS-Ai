const asyncHandler = require("../../utils/asyncHandler");
const chatThreadsService = require("./chatThreads.service");

const getAll = asyncHandler(async (req, res) => {
  res.json(await chatThreadsService.getAll(req.user));
});

const getByFolderId = asyncHandler(async (req, res) => {
  res.json(await chatThreadsService.getByFolderId(req.params.folderId, req.user));
});

const getByUserAndWorkspace = asyncHandler(async (req, res) => {
  res.json(
    await chatThreadsService.getByUserAndWorkspace(
      req.params.userId,
      req.params.workspaceId,
      req.user
    )
  );
});

const getByWorkspaceId = asyncHandler(async (req, res) => {
  res.json(
    await chatThreadsService.getByWorkspaceId(req.params.workspaceId, req.user)
  );
});

const getById = asyncHandler(async (req, res) => {
  res.json(await chatThreadsService.getById(req.params.id, req.user));
});

const create = asyncHandler(async (req, res) => {
  const thread = await chatThreadsService.create(req.body, req.user);
  res.status(201).json(thread);
});

const update = asyncHandler(async (req, res) => {
  res.json(await chatThreadsService.update(req.params.id, req.body, req.user));
});

const remove = asyncHandler(async (req, res) => {
  const result = await chatThreadsService.remove(req.params.id, req.user);
  res.json(result);
});

module.exports = {
  getAll,
  getByFolderId,
  getByUserAndWorkspace,
  getByWorkspaceId,
  getById,
  create,
  update,
  remove,
};
