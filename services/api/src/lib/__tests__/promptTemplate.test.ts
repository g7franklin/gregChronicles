import { describe, it, expect } from 'vitest';
import { renderUserPrompt, getPlaceholders } from '../promptTemplate.js';

describe('renderUserPrompt', () => {
  it('replaces all placeholders', () => {
    const template = 'Week: {{WEEK_RANGE}}\nSend: {{SEND_DATE}}\nMemos: {{MEMOS_JSON}}\nContext: {{CONTEXT_NEWSLETTERS_JSON}}\nStyle: {{STYLE_GUIDELINES}}';
    const out = renderUserPrompt(template, {
      weekRange: '2026-02-01 to 2026-02-07',
      sendDate: 'Sunday, February 8, 2026',
      memosJson: '[]',
      contextNewslettersJson: '[]',
      styleGuidelines: 'Be brief.',
    });
    expect(out).toContain('2026-02-01 to 2026-02-07');
    expect(out).toContain('Sunday, February 8, 2026');
    expect(out).toContain('[]');
    expect(out).toContain('Be brief.');
  });

  it('uses empty string for missing STYLE_GUIDELINES', () => {
    const template = '{{STYLE_GUIDELINES}}';
    const out = renderUserPrompt(template, {
      weekRange: '',
      sendDate: '',
      memosJson: '',
      contextNewslettersJson: '',
    });
    expect(out).toBe('');
  });
});

describe('getPlaceholders', () => {
  it('returns expected list', () => {
    const p = getPlaceholders();
    expect(p).toContain('{{WEEK_RANGE}}');
    expect(p).toContain('{{SEND_DATE}}');
    expect(p).toContain('{{MEMOS_JSON}}');
    expect(p).toContain('{{CONTEXT_NEWSLETTERS_JSON}}');
  });
});
