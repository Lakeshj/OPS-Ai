-- Redesign system_prompts as GLOBAL platform prompts (not bot-tied).
-- Use cases: workspace summary pipeline (+ future platform features).

DROP TABLE IF EXISTS system_prompt_assignments;
DROP TABLE IF EXISTS system_prompts;

CREATE TABLE system_prompts (
  id CHAR(36) NOT NULL,
  use_case_key VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NULL,
  prompt_content LONGTEXT NOT NULL,
  config_json JSON NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_system_prompts_use_case (use_case_key),
  KEY idx_system_prompts_active (is_active),
  CONSTRAINT fk_system_prompts_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO system_prompts (
  id, use_case_key, name, description, prompt_content, config_json, is_active
) VALUES
(
  'sp-ws-summary-extract',
  'workspace_summary_extract',
  'Workspace Summary — Document Extract',
  'Extracts factual knowledge from each uploaded document section before final summary compilation.',
  'Extract factual workspace knowledge from this document section. Preserve objectives, persona, requirements, architecture, processes, constraints, decisions, APIs, responsibilities, and deliverables. Do not add facts.',
  JSON_OBJECT(
    'model', 'gpt-4o-mini',
    'temperature', 0.2,
    'maxTokens', 1400,
    'feature', 'workspace_summary'
  ),
  1
),
(
  'sp-ws-summary-condense',
  'workspace_summary_condense',
  'Workspace Summary — Condense',
  'Condenses intermediate document summaries when content is too large for the final pass.',
  'Condense these document summaries without losing objectives, persona, requirements, decisions, constraints, responsibilities, deliverables, or important technical facts. Do not invent details.',
  JSON_OBJECT(
    'model', 'gpt-4o-mini',
    'temperature', 0.2,
    'maxTokens', 1400,
    'feature', 'workspace_summary'
  ),
  1
),
(
  'sp-ws-summary-final',
  'workspace_summary_final',
  'Workspace Summary — Final Compile',
  'Builds the authoritative workspace summary used as AI system context in chat.',
  'Create one authoritative Markdown workspace summary from the supplied document summaries. Include: overview, objectives, target persona/users, scope, requirements, architecture/technical context, workflows/processes, constraints/guidelines, responsibilities, deliverables, active decisions, and known gaps. Resolve duplication but do not invent facts. Keep it concise enough for repeated LLM context while retaining critical project knowledge.',
  JSON_OBJECT(
    'model', 'gpt-4o-mini',
    'temperature', 0.2,
    'maxTokens', 1400,
    'feature', 'workspace_summary'
  ),
  1
),
(
  'sp-ws-summary-eval',
  'workspace_summary_evaluation',
  'Workspace Summary — Evaluation',
  'Scores and critiques a generated workspace summary for quality.',
  'Evaluate the workspace summary from 0 to 100. Assess objectives, target persona, completeness, factual clarity, tone, constraints, responsibilities, deliverables, and actionable context. Return strict JSON with: score (number), feedback (string), categories (object with objectives, persona, completeness, tone, clarity, constraints, deliverables — each with score and feedback), strengths (array of strings), gaps (array of strings), and recommendations (array of strings).',
  JSON_OBJECT(
    'model', 'gpt-4o-mini',
    'temperature', 0.1,
    'maxTokens', 900,
    'responseFormat', 'json_object',
    'feature', 'workspace_summary'
  ),
  1
);
