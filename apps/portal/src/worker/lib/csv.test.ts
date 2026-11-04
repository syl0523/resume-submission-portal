import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csv', () => {
  it('leaves plain values alone and blanks empty ones', () => {
    expect(csvCell('Acme')).toBe('Acme');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Austin, TX')).toBe('"Austin, TX"');
    expect(csvCell('The "A" team')).toBe('"The ""A"" team"');
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
  });

  it('neutralises spreadsheet formulas in text', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('@sum')).toBe("'@sum");
  });

  it('joins rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});
