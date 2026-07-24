const OpenAI = require("openai");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const AppError = require("../utils/AppError");
const { normalizeProvider, inferProviderFromModel } = require("../utils/aiProviders");

const clients = {
  openai: null,
  deepseek: null,
  gemini: null,
};

const requireKey = (value, envName, providerLabel) => {
  if (!value || !String(value).trim()) {
    throw new AppError(
      `${providerLabel} API key is not configured (${envName})`,
      503,
      "AI_PROVIDER_NOT_CONFIGURED"
    );
  }
  return String(value).trim();
};

const getClientForProvider = (providerKey, modelHint = "") => {
  const provider =
    normalizeProvider(providerKey) || inferProviderFromModel(modelHint);

  if (provider === "deepseek") {
    if (!clients.deepseek) {
      clients.deepseek = new OpenAI({
        apiKey: requireKey(
          process.env.DEEPSEEK_API_KEY,
          "DEEPSEEK_API_KEY",
          "DeepSeek"
        ),
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      });
    }
    return { client: clients.deepseek, provider: "deepseek" };
  }

  if (provider === "gemini") {
    if (!clients.gemini) {
      clients.gemini = new OpenAI({
        apiKey: requireKey(
          process.env.GEMINI_API_KEY,
          "GEMINI_API_KEY",
          "Gemini"
        ),
        baseURL:
          process.env.GEMINI_BASE_URL ||
          "https://generativelanguage.googleapis.com/v1beta/openai/",
      });
    }
    return { client: clients.gemini, provider: "gemini" };
  }

  if (!clients.openai) {
    clients.openai = new OpenAI({
      apiKey: requireKey(
        process.env.OPENAI_API_KEY,
        "OPENAI_API_KEY",
        "OpenAI"
      ),
    });
  }
  return { client: clients.openai, provider: "openai" };
};

module.exports = {
  getClientForProvider,
};
