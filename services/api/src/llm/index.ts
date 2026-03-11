import { generateNewsletterDraft as claudeGenerate } from './claudeClient.js';
import { generateNewsletterDraft as grokGenerate } from './grokClient.js';

export type LlmProvider = 'claude' | 'grok';

export const DEFAULT_PROVIDER: LlmProvider = 'claude';

export interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function generateNewsletterDraft(
  options: GenerateOptions,
  provider: LlmProvider = DEFAULT_PROVIDER,
): Promise<string> {
  if (provider === 'grok') return grokGenerate(options);
  return claudeGenerate(options);
}

const DRAFT_EDIT_SYSTEM_PROMPT = `You are an editor for "The Greg Chronicle" newsletter. The user will show you the current draft (subject and body in HTML) and then ask for changes. Apply their requested edits and return the revised newsletter.

You must respond with a single JSON object only, no other text: {"subject": "string", "bodyMarkdown": "string"}
- subject: the newsletter subject line
- bodyMarkdown: the full body as HTML (same format as input). Preserve structure, styles, and layout. Only change what the user asked for.`;

export interface DraftEditResult {
  subject: string;
  bodyMarkdown: string;
}

export async function generateDraftEdit(
  options: {
    currentSubject: string;
    currentBodyMarkdown: string;
    userMessage: string;
  },
  provider: LlmProvider = DEFAULT_PROVIDER,
): Promise<DraftEditResult> {
  const { currentSubject, currentBodyMarkdown, userMessage } = options;

  const userContent = `Current draft:

**Subject:** ${currentSubject}

**Body (HTML):**
${currentBodyMarkdown}

---
User request: ${userMessage}

Reply with JSON only: {"subject": "...", "bodyMarkdown": "..."}`;

  const raw = await generateNewsletterDraft(
    {
      systemPrompt: DRAFT_EDIT_SYSTEM_PROMPT,
      userPrompt: userContent,
      temperature: 0.3,
      maxTokens: 8192,
    },
    provider,
  );

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

export function isValidProvider(value: unknown): value is LlmProvider {
  return value === 'claude' || value === 'grok';
}
