-- Collapse four internal summary prompts into one admin use case:
-- workspace_summary (Workspace Knowledge Evaluator)

DELETE FROM system_prompts
WHERE use_case_key IN (
  'workspace_summary_extract',
  'workspace_summary_condense',
  'workspace_summary_final',
  'workspace_summary_evaluation'
);

INSERT INTO system_prompts (
  id, use_case_key, name, description, prompt_content, config_json, is_active
) VALUES (
  'sp-workspace-summary',
  'workspace_summary',
  'Workspace Knowledge Evaluator',
  'Triggered when workspace files are uploaded or the summary is regenerated/updated. Defines how workspace knowledge quality is judged after summary generation.',
  'You are the Workspace Knowledge Evaluator for OpsAi.

Evaluate a workspace system summary that was generated from uploaded project documents. Score how well it captures project knowledge for AI chat context.

Return strict JSON only with this shape:
{
  "score": <number 0-100 overall accuracy>,
  "feedback": "<short overall assessment>",
  "categories": {
    "objectives": { "score": <0-100>, "feedback": "<objectives coverage>" },
    "persona": { "score": <0-100>, "feedback": "<persona consistency>" },
    "completeness": { "score": <0-100>, "feedback": "<completeness>" }
  },
  "gaps": ["<missing information item>", "..."],
  "recommendations": ["<suggestion for improvement>", "..."],
  "strengths": ["<optional strength>", "..."]
}

Scoring focus:
- Accuracy / overall quality of the summary as system context
- Objectives coverage
- Persona consistency (target users / stakeholders)
- Completeness of important project knowledge
- Missing information (gaps)
- Suggestions for improvement (recommendations)

Be strict but fair. Do not invent project facts. If information is absent from the summary, reflect that in gaps and lower completeness.',
  JSON_OBJECT(
    'model', 'gpt-4o-mini',
    'temperature', 0.1,
    'maxTokens', 900,
    'responseFormat', 'json_object',
    'feature', 'workspace_summary'
  ),
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  prompt_content = VALUES(prompt_content),
  config_json = VALUES(config_json),
  is_active = VALUES(is_active);
