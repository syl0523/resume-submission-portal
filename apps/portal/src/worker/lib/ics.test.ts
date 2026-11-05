import { describe, expect, it } from 'vitest';
import { foldLine, icsText } from './ics';

describe('ICS text values', () => {
  it('escapes backslashes, separators and every kind of line break', () => {
    expect(icsText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    // Notes pasted from old Mac apps use a lone CR; left raw it would end the content line early.
    expect(icsText('one\r\ntwo\nthree\rfour')).toBe('one\\ntwo\\nthree\\nfour');
    expect(icsText('one\r\ntwo\nthree\rfour')).not.toMatch(/[\r\n]/);
  });

  it('folds long lines without splitting a character', () => {
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}`);
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(60)}`);
  });
});
