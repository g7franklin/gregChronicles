const GROK_API_BASE = 'https://api.x.ai/v1';

export interface GrokGenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GrokMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function generateNewsletterDraft(options: GrokGenerateOptions): Promise<string> {
  const {
    systemPrompt,
    userPrompt,
    model = process.env.GROK_MODEL ?? 'grok-2-latest',
    temperature = 0.7,
    maxTokens = 8192,
  } = options;

  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY is not set');
  }

  const response = await fetch(`${GROK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Grok API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (content == null) {
    throw new Error('Grok API returned no content');
  }
  return content;
}

const DRAFT_EDIT_SYSTEM_PROMPT = `You are an editor for "The Greg Chronicle" newsletter. The user will show you the current draft (subject and body in HTML) and then ask for changes. Apply their requested edits and return the revised newsletter.

You must respond with a single JSON object only, no other text: {"subject": "string", "bodyMarkdown": "string"}
- subject: the newsletter subject line
- bodyMarkdown: the full body as HTML (same format as input). Preserve structure, styles, and layout. Only change what the user asked for.`;

export interface DraftEditResult {
  subject: string;
  bodyMarkdown: string;
}

export async function generateDraftEdit(options: {
  currentSubject: string;
  currentBodyMarkdown: string;
  userMessage: string;
}): Promise<DraftEditResult> {
  const { currentSubject, currentBodyMarkdown, userMessage } = options;
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY is not set');
  }

  const userContent = `Current draft:

**Subject:** ${currentSubject}

**Body (HTML):**
${currentBodyMarkdown}

---
User request: ${userMessage}

Reply with JSON only: {"subject": "...", "bodyMarkdown": "..."}`;

  const raw = await generateNewsletterDraft({
    systemPrompt: DRAFT_EDIT_SYSTEM_PROMPT,
    userPrompt: userContent,
    temperature: 0.3,
    maxTokens: 8192,
  });

  const trimmed = raw.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}');
  try {
    const parsed = JSON.parse(trimmed) as { subject?: string; bodyMarkdown?: string };
    return {
      subject: typeof parsed.subject === 'string' ? parsed.subject : currentSubject,
      bodyMarkdown: typeof parsed.bodyMarkdown === 'string' ? parsed.bodyMarkdown : currentBodyMarkdown,
    };
  } catch {
    throw new Error('Agent did not return valid JSON for the edited draft');
  }
}
