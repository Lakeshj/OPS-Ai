const asyncHandler = require("../../utils/asyncHandler");
const chatMessagesService = require("./chatMessages.service");

const getAll = asyncHandler(async (req, res) => {
  res.json(await chatMessagesService.getAll(req.user));
});

const getByThreadId = asyncHandler(async (req, res) => {
  res.json(
    await chatMessagesService.getByThreadId(req.params.threadId, req.user)
  );
});

const getById = asyncHandler(async (req, res) => {
  res.json(await chatMessagesService.getById(req.params.id, req.user));
});

const create = asyncHandler(async (req, res) => {
  const message = await chatMessagesService.create(req.body, req.user);
  res.status(201).json(message);
});

const update = asyncHandler(async (req, res) => {
  res.json(await chatMessagesService.update(req.params.id, req.body, req.user));
});

const remove = asyncHandler(async (req, res) => {
  await chatMessagesService.remove(req.params.id, req.user);
  res.status(204).send();
});

module.exports = {
  getAll,
  getByThreadId,
  getById,
  create,
  update,
  remove,
};
