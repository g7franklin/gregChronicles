import { generateNewsletterDraft as claudeGenerate } from './claudeClient.js';
import { generateNewsletterDraft as grokGenerate } from './grokClient.js';

export type LlmProvider = 'claude' | 'grok';

export const DEFAULT_PROVIDER: LlmProvider = 'grok';

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

const DRAFT_EDIT_SYSTEM_PROMPT = `You are an editor for "The Greg Chronicle" newsletter. The user message includes SOURCE MEMOS (raw voice memo transcripts and metadata) and the CURRENT DRAFT (subject and HTML body). Apply the user's requested edits and return the revised newsletter.

Grounding rules (critical):
- The source memos are the authoritative record of what was said and what happened for this issue. When the user asks you to elaborate, add detail, pull in more from the memos, or expand a section, you MUST only add facts, quotes, names, dates, and events that appear in those source memos or already in the current draft. Do not invent or guess details.
- If something the user wants is not supported by the memos or the draft, do not fabricate it; make only changes you can support from those sources (or leave wording general without fake specifics).

You must respond with a single JSON object only, no other text: {"subject": "string", "bodyMarkdown": "string"}
- subject: the newsletter subject line
- bodyMarkdown: the full body as HTML (same format as input). Preserve structure, styles, and layout where reasonable.`;

export interface DraftEditResult {
  subject: string;
  bodyMarkdown: string;
}

export async function generateDraftEdit(
  options: {
    currentSubject: string;
    currentBodyMarkdown: string;
    userMessage: string;
    /** Markdown block of memo transcripts for this draft; may be empty if no memos are linked. */
    sourceMemosFormatted?: string;
  },
  provider: LlmProvider = DEFAULT_PROVIDER,
): Promise<DraftEditResult> {
  const { currentSubject, currentBodyMarkdown, userMessage, sourceMemosFormatted } = options;

  const memoSection =
    sourceMemosFormatted && sourceMemosFormatted.trim().length > 0
      ? `## Source memos (use for facts and elaboration only; do not invent beyond these and the draft)\n\n${sourceMemosFormatted.trim()}\n\n---\n\n`
      : `## Source memos\n\n_No memos are linked to this draft (no memo IDs or date range). Edit only from the current draft below; do not invent events, quotes, or specifics._\n\n---\n\n`;

  const userContent = `${memoSection}## Current draft

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
      temperature: 0.2,
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
