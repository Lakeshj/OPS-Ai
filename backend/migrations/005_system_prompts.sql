-- Admin-editable Output Contracts / System Prompts
-- Assigned to bots so response format can be tuned without code changes.

CREATE TABLE IF NOT EXISTS system_prompts (
  id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  specialty_key VARCHAR(64) NOT NULL,
  content TEXT NOT NULL,
  description TEXT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_system_prompts_specialty (specialty_key),
  KEY idx_system_prompts_default (specialty_key, is_default, is_active),
  CONSTRAINT fk_system_prompts_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS system_prompt_assignments (
  assistant_id CHAR(36) NOT NULL,
  system_prompt_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (assistant_id),
  KEY idx_spa_prompt (system_prompt_id),
  CONSTRAINT fk_spa_assistant
    FOREIGN KEY (assistant_id) REFERENCES keyword_assistants(id) ON DELETE CASCADE,
  CONSTRAINT fk_spa_prompt
    FOREIGN KEY (system_prompt_id) REFERENCES system_prompts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Seed default contracts (idempotent by fixed IDs)
INSERT IGNORE INTO system_prompts (id, name, specialty_key, content, description, is_default, is_active)
VALUES
(
  'sp-default-chat',
  'Default Chat Contract',
  'chat',
  '## Output Contract
Return a clear, useful answer grounded in the Workspace Summary.
Use short sections with headings when helpful.
Do not invent project facts that are not in the provided context.
If the request is ambiguous, ask one clarifying question first.',
  'Fallback format for general chat bots and no-bot requests.',
  1,
  1
),
(
  'sp-default-image-prompt',
  'Image Prompt Contract',
  'image_prompt',
  '## Output Contract
You write IMAGE GENERATION PROMPTS only (not video scripts).
Return ONLY these sections, in this exact order:

1. **Prompt** — one dense paragraph (max 120 words) describing the final image
2. **Style** — 3 to 5 short bullets (medium, lighting, color, composition)
3. **Negative Prompt** — 5 to 10 short bullets of what to avoid

Rules:
- Do NOT include Camera shot lists, Animation, Scene Breakdown, Dialogue, or Duration
- Do NOT write a video script
- Keep the Prompt copy-paste ready for an image model',
  'Format rules for image prompt engineer bots.',
  1,
  1
),
(
  'sp-default-video-prompt',
  'Video Prompt Contract',
  'video_prompt',
  '## Output Contract
You write VIDEO GENERATION PROMPTS / DIRECTION only.
Return ONLY these sections, in this exact order:

1. **Hook** — 1 sentence opening line
2. **Scene Breakdown** — Scene 1 / 2 / 3 with approximate duration and action
3. **Visual Direction** — camera, motion, lighting, style (short bullets)
4. **Negative Prompt** — what to avoid (short bullets)

Rules:
- Do NOT write a static image mockup brief
- Do NOT omit duration or scene structure
- Keep the result production-ready for an AI video tool',
  'Format rules for video prompt engineer bots.',
  1,
  1
),
(
  'sp-default-keywords',
  'Keywords / SEO Contract',
  'keywords',
  '## Output Contract
Return SEO / keyword output ONLY in this structure:

1. **Primary Keyword** — one phrase
2. **Secondary Keywords** — 5 to 10 phrases
3. **Title Ideas** — 3 options
4. **Meta Description** — one line under 155 characters

Do not add long essays unless the user explicitly asks.',
  'Format rules for SEO and keyword bots.',
  1,
  1
),
(
  'sp-default-image',
  'Image Generation Contract',
  'image',
  '## Output Contract
Prepare a single image-generation brief from the user request and workspace context.
Focus on subject, composition, style, and brand-relevant details.
Keep the brief concise and visual.',
  'Used when capabilityType is image (media generation path).',
  1,
  1
),
(
  'sp-default-video',
  'Video Generation Contract',
  'video',
  '## Output Contract
Prepare a video-generation brief from the user request and workspace context.
Include hook, scene flow, and visual direction.
Keep the result usable by a video generation tool.',
  'Used when capabilityType is video.',
  1,
  1
),
(
  'sp-default-audio',
  'Audio Generation Contract',
  'audio',
  '## Output Contract
Prepare an audio / voice brief from the user request and workspace context.
Include tone, pacing, script length, and delivery notes.
Keep the result usable by an audio generation tool.',
  'Used when capabilityType is audio.',
  1,
  1
);
