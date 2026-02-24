export interface PromptContext {
  weekRange: string;
  sendDate: string;
  memosJson: string;
  contextNewslettersJson: string;
  styleGuidelines?: string;
}

const PLACEHOLDERS = [
  '{{WEEK_RANGE}}',
  '{{SEND_DATE}}',
  '{{MEMOS_JSON}}',
  '{{CONTEXT_NEWSLETTERS_JSON}}',
  '{{STYLE_GUIDELINES}}',
] as const;

export function renderUserPrompt(template: string, context: PromptContext): string {
  let out = template;
  out = out.replace(/\{\{WEEK_RANGE\}\}/g, context.weekRange);
  out = out.replace(/\{\{SEND_DATE\}\}/g, context.sendDate);
  out = out.replace(/\{\{MEMOS_JSON\}\}/g, context.memosJson);
  out = out.replace(/\{\{CONTEXT_NEWSLETTERS_JSON\}\}/g, context.contextNewslettersJson);
  out = out.replace(/\{\{STYLE_GUIDELINES\}\}/g, context.styleGuidelines ?? '');
  return out;
}

export function getPlaceholders(): readonly string[] {
  return PLACEHOLDERS;
}
