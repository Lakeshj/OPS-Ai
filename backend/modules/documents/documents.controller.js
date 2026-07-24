const asyncHandler = require("../../utils/asyncHandler");
const documentsService = require("./documents.service");

const listByWorkspace = asyncHandler(async (req, res) => {
  res.json(
    await documentsService.listByWorkspace(req.params.workspaceId, req.user)
  );
});

const getById = asyncHandler(async (req, res) => {
  res.json(await documentsService.getById(req.params.id, req.user));
});

const upload = asyncHandler(async (req, res) => {
  const document = await documentsService.createFromUpload(
    req.params.workspaceId,
    req.user,
    req.file,
    req.uploadMeta
  );
  res.status(201).json(document);
});

const reconvert = asyncHandler(async (req, res) => {
  res.json(await documentsService.reconvert(req.params.id, req.user));
});

const remove = asyncHandler(async (req, res) => {
  const result = await documentsService.remove(req.params.id, req.user);
  res.status(200).json(result);
});

module.exports = {
  listByWorkspace,
  getById,
  upload,
  reconvert,
  remove,
};
