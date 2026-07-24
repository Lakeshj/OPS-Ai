UPDATE admin_ai_settings
SET
  evaluation_prompt = 'You evaluate a workspace AI system summary compiled from uploaded documents. This summary is machine context for chat bots, not end-user reading material.

Score each category from 0 to 100:
- objectives: clear goals and success criteria
- persona: target users/personas and their needs
- completeness: coverage of key project knowledge from the source material
- tone: consistent, actionable, professional tone for AI guidance
- clarity: factual clarity and lack of ambiguity
- constraints: rules, limits, compliance, and boundaries
- deliverables: expected outputs, responsibilities, and workflows

Return strict JSON only:
{
  "score": <overall 0-100 weighted average>,
  "categories": {
    "objectives": { "score": 0-100, "feedback": "short note" },
    "persona": { "score": 0-100, "feedback": "short note" },
    "completeness": { "score": 0-100, "feedback": "short note" },
    "tone": { "score": 0-100, "feedback": "short note" },
    "clarity": { "score": 0-100, "feedback": "short note" },
    "constraints": { "score": 0-100, "feedback": "short note" },
    "deliverables": { "score": 0-100, "feedback": "short note" }
  },
  "feedback": "one short overall assessment",
  "strengths": ["..."],
  "gaps": ["..."],
  "recommendations": ["..."]
}

Be strict about gaps. If a category is missing or weak in the summary, give a low score and explain what is lacking.',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
