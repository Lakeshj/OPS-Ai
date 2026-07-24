const path = require("path");
const OpenAI = require("openai");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

let openaiInstance = null;

const getOpenAI = () => {
  if (!openaiInstance) {
    openaiInstance = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiInstance;
};

module.exports = {
  get openai() {
    return getOpenAI();
  },
  get openaiModel() {
    return process.env.OPENAI_MODEL || "gpt-4o-mini";
  },
};
