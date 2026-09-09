/**
 * Part 14D.2/14D.3 — Semantic Copilot intent router + mutation consistency guard.
 *
 * Tiny deterministic fast-paths for obvious product commands / tests.
 * Broad / typo-heavy / general knowledge defaults to GENERAL (LLM answers).
 * Never: unknown → CREATE.
 */

const {
  WORKFLOW_COPILOT_NAME,
  fixtureIdentityAnswer,
} = require("../config/opsaiAssistantIdentity");
const { usesWorkflowInputResources } = require("./resourceLocator");

const CONVERSATIONAL_INTENTS = Object.freeze([
  "GENERAL",
  "INFORMATION",
  "AUTOMATION_ADVICE",
  "CLARIFY",
]);

const MUTATION_INTENTS = Object.freeze(["CREATE", "BUILD", "MODIFY", "FIX"]);

const READ_ONLY_INTENTS = Object.freeze([
  "EXPLAIN",
  "DEBUG",
  "GENERAL",
  "INFORMATION",
  "AUTOMATION_ADVICE",
  "CLARIFY",
]);

const MUTATION_OP_TYPES = new Set([
  "addNode",
  "removeNode",
  "updateNodeParameters",
  "renameNode",
  "connectNodes",
  "disconnectEdge",
  "reconnectEdge",
  "setWorkflowSetting",
]);

const normalizeMsg = (raw) =>
  String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const stripHashtags = (raw) =>
  String(raw || "").replace(/#[^\s#]+/g, " ");

const detectPendingClarification = (req = {}) => {
  const c = req.clarification;
  if (c?.questionId || c?.field) {
    const id = String(c.questionId || c.field || "").toLowerCase();
    if (/name|workflow.?name|title/.test(id)) {
      return { type: "WORKFLOW_NAME", questionId: c.questionId || c.field };
    }
    if (/url|endpoint/.test(id)) {
      return { type: "URL", questionId: c.questionId || c.field };
    }
    if (/purpose|destination|where|help_focus/.test(id)) {
      return { type: "PURPOSE", questionId: c.questionId || c.field };
    }
    return { type: "GENERIC", questionId: c.questionId || c.field };
  }

  const recent = Array.isArray(req.recentConversation)
    ? req.recentConversation
    : [];
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const turn = recent[i];
    if (!turn) continue;
    if (turn.role === "user") break;
    if (turn.role !== "assistant") continue;
    const content = String(turn.content || "");
    if (
      /what should (i |we )?name|name (this|the) workflow|workflow name|provide a name for the workflow/i.test(
        content
      )
    ) {
      return { type: "WORKFLOW_NAME", questionId: "workflowName" };
    }
    if (/what (is|should).*(api )?url|crm api url|endpoint/i.test(content)) {
      return { type: "URL", questionId: "url" };
    }
    if (
      /want me to (add|apply|do)|shall i (add|apply)|should i (add|apply)|ready to apply|apply (these|this)|i recommend adding/i.test(
        content
      )
    ) {
      return { type: "CONFIRM_ACTION", questionId: "confirm_action" };
    }
  }
  return null;
};

const isIdentityQuestion = (raw) => {
  const text = normalizeMsg(stripHashtags(raw));
  if (!text || text.length > 120) return false;
  return (
    /^(name|what('?s| is) your name|who are you|what are you|where are you from|where do you live|who (created|made|built|creat) (you|u)|who('?s| is) your (creator|maker)|are you a (bot|ai|assistant)|what can (you|u) do)\b/.test(
      text
    ) ||
    /^name\?*$/.test(text) ||
    /^(u|you)\s+know\s+who\s+(i'?m|i\s+am)\b/.test(text) ||
    /^who\s+am\s+i\b/.test(text) ||
    /^do\s+(you|u)\s+know\s+who\s+(i\s+am|i'?m)\b/.test(text) ||
    /^what('?s| is)\s+my\s+(name|email)\b/.test(text) ||
    /^what\s+email\s+do\s+(you|u)\s+know/.test(text)
  );
};

const isAuthorityClaim = (raw) => {
  const text = normalizeMsg(stripHashtags(raw));
  if (!text || text.length > 160) return false;
  return (
    /^(i'?m|i\s+am|im)\s+(ur|your)\s+creator\b/.test(text) ||
    /^(i\s+built\s+you|i\s+created\s+you|i\s+own\s+(you|opsai|the\s+app))\b/.test(
      text
    ) ||
    /^(i'?m|i\s+am|im)\s+(the\s+)?(admin|owner|root|developer)\b/.test(text) ||
    /\b(ignore\s+(the\s+)?(restriction|safeguard)|disable\s+safeguards|apply\s+every\s+change\s+without\s+confirmation|show\s+(me\s+)?(your\s+)?system\s+prompt|give\s+me\s+(all\s+)?(api\s+)?keys)\b/.test(
      text
    )
  );
};

const isCasualGeneral = (raw) => {
  const text = normalizeMsg(stripHashtags(raw));
  if (!text || text.length > 80) return false;
  if (isIdentityQuestion(text)) return true;
  if (
    /^(hi|hello|hey|yo|sup|hiya|howdy|thanks|thank you|thx|ty|ok|okay|cool|great|nice|bye|goodbye|see you|gm|gn)([!.]*)$/i.test(
      text
    )
  ) {
    return true;
  }
  if (
    /^(how\s+are\s+(you|u|ya)|how\s+r\s+(you|u)|how'?s\s+it\s+going|whats?\s+up|what'?s\s+up|hru)([!.]*)$/.test(
      text
    )
  ) {
    return true;
  }
  if (/^(good\s+(morning|afternoon|evening|night))([!.]*)$/.test(text)) {
    return true;
  }
  if (
    /^(i\s+asked\s+(you|u)(\s+something)?|you\s+didn'?t\s+answer|answer\s+(me|my)|are\s+you\s+(there|here)|you\s+there|that'?s\s+cool|nice\s+thanks|got\s+it(\s+thanks)?)([!.]*)$/.test(
      text
    )
  ) {
    return true;
  }
  return false;
};

/** Broad general / knowledge / opinion — LLM answers; not workflow EXPLAIN. */
const isBroadGeneralOrKnowledge = (raw) => {
  const text = normalizeMsg(stripHashtags(raw));
  if (!text) return false;
  if (
    /\b(intelligence|intelegence|intelligent|creativity|judgment|conscious|emotion|joke|gravity|machine learning|opinon|opinion|brainstorm|sleep|human|humans|compared with|compare(d)? to)\b/.test(
      text
    )
  ) {
    return true;
  }
  if (
    /\b(howmuch|how much).*(intel|smart|brain|iq)\b/.test(text) ||
    /\b(ur|your)\s+(intel|creator|model)\b/.test(text)
  ) {
    return true;
  }
  if (
    /^(tell me a joke|explain gravity|what is (ai|machine learning)|help me brainstorm|do you have emotions|are you conscious)\b/.test(
      text
    )
  ) {
    return true;
  }
  if (/^(wht|what)\s+model\s+(u|you)\s+use/.test(text)) {
    return true;
  }
  return false;
};

const isInformationQuestion = (raw) => {
  const text = normalizeMsg(raw);
  if (!text) return false;
  if (/\bwhat does this\b/.test(text)) return false;
  if (/\bexplain this (workflow|node)\b/.test(text)) return false;
  if (isBroadGeneralOrKnowledge(text) && !/\b(api|webhook|filter|credential|schedule|loop|wait)\b/.test(text)) {
    return false; // GENERAL, not OpsAi product INFORMATION
  }
  if (
    /^(what is|what'?s|what are|what does|what can|how does|how do|difference between|compare)\b/.test(
      text
    ) &&
    /\b(api|apis|webhook|webhooks|filter|switch|merge|schedule|http|credential|credentials|trigger|node|loop|wait|result|opsai|auxiliary|gmail|ga4|analytics|search console|google sheets|ai generate|ai agent|xlsx)\b/.test(
      text
    ) &&
    !/\bthis\b/.test(text)
  ) {
    return true;
  }
  if (
    /^what does a\b/.test(text) &&
    /\b(filter|switch|merge|webhook|http|schedule|gmail|sheets)\b/.test(text)
  ) {
    return true;
  }
  if (
    /what (does|can) (the )?(google search console|gsc|ga4|google analytics|gmail|google sheets|ai generate)/.test(
      text
    )
  ) {
    return true;
  }
  if (/ai generate vs|vs ai agent|difference between ai generate/.test(text)) {
    return true;
  }
  if (
    /can (one|a|the same) google account/.test(text) ||
    (/multiple (web)?sites/.test(text) &&
      /\b(google|credential|account|gsc|search console)\b/.test(text)) ||
    /one credential.{0,80}(many|multiple)/.test(text)
  ) {
    return true;
  }
  return false;
};

const isAutomationAdvice = (raw) => {
  const text = normalizeMsg(raw);
  if (!text) return false;
  if (
    /\b(would (a |an )?\w+ help|maybe we should|i think a \w+ would|should i use|best way|how (would|should) (you|i) (design|automate)|how could i|recommend|advice|process \d|thousands of|10,?000)\b/.test(
      text
    )
  ) {
    return true;
  }
  if (/\b(webhook or schedule|schedule or webhook)\b/.test(text)) {
    return true;
  }
  return false;
};

const isAmbiguousAction = (raw) => {
  const text = normalizeMsg(raw);
  if (!text) return false;
  return /^(help me|make this better|connect this|send this somewhere|do something|improve this|fix stuff)([!.]*)$/.test(
    text
  );
};

const isBareAffirmation = (raw) => {
  const text = normalizeMsg(raw);
  return /^(yes|yep|yeah|sure|ok|okay|do it|go ahead|apply|looks good)([!.]*)$/i.test(
    text
  );
};

const hasClearActionVerb = (text) =>
  /\b(add|insert|create|build|change|update|set|remove|delete|connect|fix|clear|reset|rename|move|send\s+to|call\s+my|every\s+weekday|every\s+monday|pull|append)\b/.test(
    text
  ) ||
  /\b(can you add|please add|add a |add an |change .+ to|make .+ (like|similar))\b/.test(
    text
  ) ||
  /\b(use\s+ai|let the ai|ai\s+agent|ai calculate|ai summary|generate an ai)\b/.test(text) ||
  /\bhttps?:\/\//.test(text);

/**
 * Semantic intent classification.
 */
const classifyPlanningIntent = (
  message,
  { selectedNodeId, runId, definition, recentConversation, clarification } = {}
) => {
  const text = String(message || "").toLowerCase();
  const nodes = definition?.nodes || [];
  const hasGraph = nodes.length > 0;
  const pending = detectPendingClarification({
    clarification,
    recentConversation,
  });

  // Authority / social-engineering claims never become mutations.
  if (isAuthorityClaim(message)) {
    return "GENERAL";
  }

  // FIX before generic action (fix/repair must not become bare MODIFY)
  if (
    /\b(fix\s+(this|it|everything)|repair|heal|fix\s+the\s+missing)\b/.test(
      text
    ) ||
    (/\bfix\b/.test(text) &&
      /\b(missing|broken|error|model|it|this|everything)\b/.test(text))
  ) {
    return "FIX";
  }

  // Capability / product questions stay INFORMATION even if they mention node names
  if (
    isInformationQuestion(message) &&
    (/^(what|how|difference|compare|can)\b/.test(text) ||
      /multiple (web)?sites|one google account/.test(text)) &&
    !/\b(add|insert|create|build|change|update|remove|delete|connect|pull|append)\b/.test(
      text
    )
  ) {
    return "INFORMATION";
  }

  // Mixed turns: clear workflow action verbs win over identity / soft EXPLAIN
  if (
    (hasClearActionVerb(text) ||
      usesWorkflowInputResources(message) ||
      /\b(and (change|add|update|set|create|build)|change it to|add a |add an )\b/.test(
        text
      )) &&
    !/\bfix\b/.test(text)
  ) {
    if (!hasGraph) return "CREATE";
    return "MODIFY";
  }

  // Pending confirmation ("do it" / "yes") after a recommendation
  if (isBareAffirmation(message) && pending?.type === "CONFIRM_ACTION") {
    return hasGraph ? "MODIFY" : "CREATE";
  }

  // Pending WORKFLOW_NAME — only if not identity and not a new GENERAL question
  if (
    pending?.type === "WORKFLOW_NAME" &&
    !isIdentityQuestion(message) &&
    !isAuthorityClaim(message) &&
    !isBroadGeneralOrKnowledge(message) &&
    !isCasualGeneral(message) &&
    /^[a-z0-9][\w\s\-']{0,80}$/i.test(String(message || "").trim()) &&
    !/\?/.test(String(message || ""))
  ) {
    return hasGraph ? "MODIFY" : "CREATE";
  }

  // Bare yes/do it with NO pending proposal → GENERAL (no mutation)
  if (isBareAffirmation(message) && pending?.type !== "CONFIRM_ACTION") {
    return "GENERAL";
  }

  if (
    isIdentityQuestion(message) ||
    isAuthorityClaim(message) ||
    isCasualGeneral(message)
  ) {
    return "GENERAL";
  }

  if (isBroadGeneralOrKnowledge(message) && !hasClearActionVerb(text)) {
    return "GENERAL";
  }

  if (
    /\b(why\s+did\s+(this|it)\s+fail|what\s+went\s+wrong|troubleshoot|why\s+failed|why\s+did\s+the\s+last\s+run\s+fail|why\s+dis\s+workflow\s+not\s+wrk)\b/.test(
      text
    ) ||
    (/\bdebug\b/.test(text) && !/\bprefix\b/.test(text)) ||
    (runId &&
      /\b(fail|error|broke)\b/.test(text) &&
      !/\bfix\b/.test(text) &&
      !isCasualGeneral(message) &&
      !isBroadGeneralOrKnowledge(message))
  ) {
    return "DEBUG";
  }
  if (
    /\b(fix\s+(this|it)|repair|heal|fix\s+the\s+missing|fix\s+everything)\b/.test(
      text
    ) ||
    (/\bfix\b/.test(text) && /\b(missing|broken|error|model|it|this)\b/.test(text))
  ) {
    return "FIX";
  }

  if (isAmbiguousAction(message)) {
    return "CLARIFY";
  }

  // Soft advice (not action)
  if (isAutomationAdvice(message) && !/\b(can you add|please add|add a |add an )\b/.test(text)) {
    return "AUTOMATION_ADVICE";
  }

  // Workflow EXPLAIN — only current workflow / selected node
  if (
    selectedNodeId &&
    /\b(what\s+does\s+this|explain\s+this|describe\s+this)\b/.test(text)
  ) {
    return "EXPLAIN";
  }
  if (
    /\b(explain\s+this\s+workflow|describe\s+this\s+workflow|what\s+does\s+this\s+workflow)\b/.test(
      text
    )
  ) {
    return "EXPLAIN";
  }
  // "explain gravity" etc. is GENERAL — not workflow EXPLAIN
  if (/^\s*explain\b/.test(text) && !/\b(this|workflow|node|filter|http)\b/.test(text)) {
    return "GENERAL";
  }
  if (
    /^\s*explain\b/.test(text) &&
    /\b(this\s+workflow|this\s+node)\b/.test(text)
  ) {
    return "EXPLAIN";
  }

  if (isInformationQuestion(message)) {
    return "INFORMATION";
  }

  if (
    /\bwhat\s+did\b.+\b(return|output|result)\b/.test(text) ||
    /\b(latest\s+result|what\s+was\s+returned)\b/.test(text)
  ) {
    return "EXPLAIN";
  }
  if (
    /\b(compar|while\s+#|whereas|but\s+#|vs\.?|versus)\b/.test(text) &&
    /#/.test(text)
  ) {
    return "EXPLAIN";
  }

  // Construction / mutation
  if (
    hasClearActionVerb(text) ||
    /\b(use\s+ai|ai\s+agent|scaffold|new\s+workflow|schedule|wait\s+\d|batch|loop|only\s+continue|aftr|after this)\b/.test(
      text
    ) ||
    /\b(make\s+this\s+(like|similar)|similar\s+to\s+#|make\s+same\s+as\s+#)\b/.test(
      text
    ) ||
    /\b(send\s+(this\s+)?to\s+\w+|slack|gmail)\b/.test(text) ||
    /\b(after\s+this|then\s+run|run\s+#|execute\s+#)\b/.test(text) ||
    /\bhttps?:\/\//.test(text) ||
    /\b(gets?|fetch|call)\b.+\b(api|http|url|jsonplaceholder)\b/.test(text) ||
    /\b(wait\s+\d+|\d+\s+at\s+a\s+time|process\s+\w+|batch\s*size)\b/.test(text)
  ) {
    if (
      /\b(fix\s+this|can\s+you\s+(fix|repair)|repair\s+this|connect\s+the\s+missing\s+model)\b/.test(
        text
      )
    ) {
      return "FIX";
    }
    if (
      !hasGraph &&
      /\b(create|build|new\s+workflow|every\s+weekday|use\s+ai|call\s+my|send\s+every|let\s+the\s+ai|gets?\s+https?:|https?:\/\/|slack|crm|can you add|add a )\b/.test(
        text
      )
    ) {
      return "CREATE";
    }
    if (!hasGraph) return "CREATE";
    return "MODIFY";
  }

  if (/\b(add|insert)\s+(a\s+|an\s+|one\b)/.test(text)) {
    return hasGraph ? "MODIFY" : "CREATE";
  }

  if (
    /\b(why\s+(can'?t|cannot)\s+i\s+run|what('?s|\s+is)\s+wrong|why\s+is\s+(this|it)\s+(failing|stuck)|why\s+didn'?t|whats?\s+wrong\s+here)\b/.test(
      text
    )
  ) {
    return "DEBUG";
  }

  // Uncertain non-action → GENERAL (LLM). Never CREATE.
  if (/\?$/.test(String(message || "").trim()) || /^(what|how|why|when|where|who)\b/.test(text)) {
    return "GENERAL";
  }

  return "GENERAL";
};

const enforceIntentOperationConsistency = ({
  intent,
  operations = [],
} = {}) => {
  const ops = Array.isArray(operations) ? operations : [];
  const mutationOps = ops.filter((o) => o && MUTATION_OP_TYPES.has(o.type));
  const normalized = intent === "BUILD" ? "CREATE" : intent;

  if (CONVERSATIONAL_INTENTS.includes(normalized) && mutationOps.length) {
    return {
      ok: false,
      code: "COPILOT_INTENT_OP_MISMATCH",
      message: `${normalized} cannot include graph operations`,
      operations: [],
    };
  }
  if (normalized === "EXPLAIN" && mutationOps.length) {
    return {
      ok: false,
      code: "COPILOT_INTENT_OP_MISMATCH",
      message: "EXPLAIN cannot include graph operations",
      operations: [],
    };
  }
  if (normalized === "DEBUG" && mutationOps.length) {
    return {
      ok: false,
      code: "COPILOT_INTENT_OP_MISMATCH",
      message: "DEBUG cannot include graph operations (use FIX)",
      operations: [],
    };
  }
  if (MUTATION_INTENTS.includes(normalized) || normalized === "CREATE") {
    return { ok: true, operations: ops };
  }
  return { ok: true, operations: mutationOps.length ? [] : ops };
};

/** Test-only fixtures — never primary production intelligence. */
const conversationalFixtureReply = (
  intent,
  message,
  safeUserContext = null
) => {
  const text = normalizeMsg(message);

  // Claimed authority / identity-with-context before generic creator/model heuristics.
  if (isAuthorityClaim(message) || isIdentityQuestion(message)) {
    const fromCtx = fixtureIdentityAnswer(
      "copilot",
      message,
      safeUserContext
    );
    if (fromCtx) return fromCtx;
  }

  if (isIdentityQuestion(message) || intent === "GENERAL") {
    if (isIdentityQuestion(message)) {
      return fixtureIdentityAnswer("copilot", message, safeUserContext);
    }
    if (/how\s+are\s+(you|u|ya)|how'?s\s+it\s+going|hru/.test(text)) {
      return "I'm doing well! How can I help?";
    }
    if (/intel|intelegence|intelligent|human/.test(text)) {
      return "AI and human intelligence are different — I can process language and patterns quickly, while humans bring lived experience, judgment, and creativity. I'm useful as a collaborator, not a replacement.";
    }
    // "who created you" / model questions — not "I'm your creator"
    if (
      /who\s+(created|made|built)|what.*creator|model\s+u\s+use|what.*used/.test(
        text
      ) &&
      !isAuthorityClaim(message)
    ) {
      return "I'm powered by the configured AI/LLM infrastructure inside OpsAi, plus OpsAi's own product and workflow layer. I won't invent a specific model vendor as my creator.";
    }
    if (/joke/.test(text)) {
      return "Why did the HTTP request go to therapy? Too many unresolved redirects.";
    }
    if (/thanks|thank you|nice thanks|got it/.test(text)) {
      return "You're welcome!";
    }
    if (/hi|hello|hey|yo|sup/.test(text)) {
      return `Hi! I'm ${WORKFLOW_COPILOT_NAME}. I can help you build, understand, debug, or improve this workflow — or just answer questions.`;
    }
    return `I'm ${WORKFLOW_COPILOT_NAME}. What would you like to work on?`;
  }
  if (intent === "INFORMATION") {
    if (
      /multiple (web)?sites|one google account|same google credential|one credential/.test(
        text
      )
    ) {
      return "Yes. A Google credential authorizes the connected account; each node selects its own site, GA4 property, spreadsheet, or label. One credential can be reused across many resources when that account has access.";
    }
    if (/search console|gsc/.test(text)) {
      return "Google Search Console pulls query or page search analytics (clicks, impressions, CTR, position) for an authorized site. It does not crawl the web or invent rankings.";
    }
    if (/ga4|google analytics/.test(text)) {
      return "Google Analytics (GA4) runs a report for a property: metrics such as sessions and totalUsers, optional dimensions, date ranges, filters, and limits. Rows become workflow items.";
    }
    if (/\bgmail\b/.test(text)) {
      return "Gmail sends, reads, and labels mail using a Google credential. Attachments come from WorkflowItem binary (for example XLSX Builder output). Gmail Trigger polls on an interval — it is not push/real-time.";
    }
    if (/google sheets|sheets/.test(text)) {
      return "Google Sheets reads and writes tabular rows. With a header row, each row becomes a named workflow item. Writes can use RAW or USER_ENTERED values.";
    }
    if (/ai generate/.test(text) || /vs ai agent|ai generate vs/.test(text)) {
      return "AI Generate is a main-flow node: one model request per incoming item, no tools or memory. AI Agent is for iterative tool use. Chat Model is an auxiliary resource for Agent, not a standalone execution step.";
    }
    if (/\bapi\b/.test(text)) {
      return "An API lets software talk to other software — usually over HTTP with JSON responses.";
    }
    if (/\bwebhook\b/.test(text)) {
      return "A webhook is an HTTP endpoint another system calls when an event happens.";
    }
    if (/\bfilter\b/.test(text)) {
      return "A Filter keeps matching items and drops the rest. Zero matches is success with empty output, not a failure.";
    }
    return "Happy to explain OpsAi workflow concepts.";
  }
  if (intent === "AUTOMATION_ADVICE") {
    return "A Filter can help when you need to drop non-matching items before downstream work. Say if you want me to add one.";
  }
  if (intent === "CLARIFY") {
    return "What would you like help with — building, fixing, or understanding this workflow?";
  }
  return `I'm ${WORKFLOW_COPILOT_NAME}. How can I help?`;
};

module.exports = {
  CONVERSATIONAL_INTENTS,
  MUTATION_INTENTS,
  READ_ONLY_INTENTS,
  classifyPlanningIntent,
  detectPendingClarification,
  isIdentityQuestion,
  isAuthorityClaim,
  isCasualGeneral,
  isBroadGeneralOrKnowledge,
  isInformationQuestion,
  isAutomationAdvice,
  isAmbiguousAction,
  isBareAffirmation,
  enforceIntentOperationConsistency,
  conversationalFixtureReply,
  normalizeMsg,
};
