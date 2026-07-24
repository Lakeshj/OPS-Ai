const usesModernCompletionTokens = (model) =>
  /^(gpt-5|o[1-9]|gpt-4\.1)/i.test(String(model || ""));

const withGenerationOptions = (
  model,
  { maxTokens, temperature, ...options }
) => {
  const result = { model, ...options };

  if (usesModernCompletionTokens(model)) {
    result.max_completion_tokens = maxTokens;
  } else {
    result.max_tokens = maxTokens;
    if (temperature !== undefined) result.temperature = temperature;
  }

  return result;
};

module.exports = { withGenerationOptions };
