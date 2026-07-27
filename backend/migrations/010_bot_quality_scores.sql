-- Bot quality / design evaluation fields on keyword_assistants
ALTER TABLE keyword_assistants
  ADD COLUMN quality_score DECIMAL(5,2) NULL AFTER description,
  ADD COLUMN quality_feedback LONGTEXT NULL AFTER quality_score,
  ADD COLUMN quality_details JSON NULL AFTER quality_feedback,
  ADD COLUMN quality_model VARCHAR(100) NULL AFTER quality_details,
  ADD COLUMN quality_evaluated_at TIMESTAMP NULL AFTER quality_model;

-- Seed second system-prompt use case: AI Assistant Design Validator
INSERT INTO system_prompts (
  id,
  use_case_key,
  name,
  description,
  prompt_content,
  config_json,
  is_active,
  created_by
)
SELECT
  UUID(),
  'bot_design',
  'AI Assistant Design Validator',
  'Scores bot design quality (prompt, role clarity, capability fit) on the Assistants page.',
  'You are OpsAi''s AI Assistant Design Validator.

Evaluate the bot configuration for production readiness. Score how well the bot is designed to serve users inside a workspace chat product.

Focus on:
1) Role clarity — does the name, task type, and description make the bot''s job obvious?
2) Prompt quality — is the prompt template specific, actionable, and free of contradictions?
3) Capability fit — does the chosen capability/provider/model match the intended job (chat vs image vs video)?
4) Instruction strength — does the prompt set clear rules, tone, output format, and constraints?
5) Workspace usefulness — will this bot help users without needing constant re-explanation?
6) Safety / guardrails — does it avoid unsafe or overly open-ended behavior for its role?

Be strict but fair. Prefer concrete feedback over vague praise.
Return JSON only as specified in the contract.',
  JSON_OBJECT(
    'model', 'gpt-4o-mini',
    'temperature', 0.1,
    'maxTokens', 2000,
    'feature', 'bot_design',
    'scoringCategories', JSON_ARRAY(
      'role_clarity',
      'prompt_quality',
      'capability_fit',
      'instruction_strength',
      'workspace_usefulness',
      'safety_guardrails'
    )
  ),
  1,
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM system_prompts WHERE use_case_key = 'bot_design'
);
