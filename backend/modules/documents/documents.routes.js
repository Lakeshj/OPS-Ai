const express = require("express");
const { requireRole } = require("../../middleware/auth");
const { singleUpload } = require("./documents.upload");
const {
  listByWorkspace,
  getById,
  upload,
  reconvert,
  remove,
} = require("./documents.controller");

const workspaceRouter = express.Router({ mergeParams: true });
const documentRouter = express.Router();

workspaceRouter.get("/", listByWorkspace);
workspaceRouter.post(
  "/",
  requireRole("Admin", "Project Manager"),
  ...singleUpload,
  upload
);

documentRouter.get("/:id", getById);
documentRouter.post(
  "/:id/reconvert",
  requireRole("Admin", "Project Manager"),
  reconvert
);
documentRouter.delete(
  "/:id",
  requireRole("Admin", "Project Manager"),
  remove
);

module.exports = {
  workspaceRouter,
  documentRouter,
};
