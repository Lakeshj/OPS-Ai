ALTER TABLE keyword_assistants
  ADD COLUMN provider VARCHAR(50) NOT NULL DEFAULT 'openai' AFTER capability_type;

UPDATE keyword_assistants
SET provider = CASE
  WHEN LOWER(model) LIKE 'deepseek%' THEN 'deepseek'
  WHEN LOWER(model) LIKE 'gemini%' THEN 'gemini'
  ELSE 'openai'
END;
