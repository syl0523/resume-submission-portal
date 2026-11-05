import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  htmlToText,
  normalizeCompany,
  normalizeTitle,
  similarity,
  truncate,
} from './text';

describe('normalizeCompany', () => {
  it('drops legal suffixes, punctuation and a leading "the"', () => {
    expect(normalizeCompany('Acme Logistics, Inc.')).toBe('acme logistics');
    expect(normalizeCompany('The Home Depot Canada Ltd.')).toBe('home depot canada');
    expect(normalizeCompany('Procter & Gamble Co')).toBe('procter and gamble');
    expect(normalizeCompany('Société Générale S.A.')).toBe('societe generale s a');
  });

  it('keeps a lone suffix-like word and CJK names', () => {
    expect(normalizeCompany('Co')).toBe('co');
    expect(normalizeCompany('顺丰速运')).toBe('顺丰速运');
  });
});

describe('normalizeTitle', () => {
  it('removes requisition ids and bracketed qualifiers', () => {
    expect(normalizeTitle('HR Generalist (Bilingual) - Req ID: R-12345')).toBe('hr generalist');
    expect(normalizeTitle('Warehouse Supervisor [Night Shift]')).toBe('warehouse supervisor');
  });
});

describe('similarity', () => {
  it('scores identical and reordered titles highly', () => {
    expect(similarity('HR Business Partner', 'hr business partner')).toBe(1);
    expect(similarity('Senior HR Generalist', 'HR Generalist, Senior')).toBeGreaterThan(0.8);
  });

  it('scores unrelated titles low', () => {
    expect(similarity('Payroll Specialist', 'Forklift Operator')).toBeLessThan(0.3);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('htmlToText', () => {
  it('keeps structure as line breaks and bullets', () => {
    const html =
      '<h2>About</h2><p>We move <b>freight</b>&nbsp;fast.</p><ul><li>Hire</li><li>Train</li></ul><script>x()</script>';
    expect(htmlToText(html)).toBe('About\nWe move freight fast.\n\n• Hire\n• Train');
  });

  it('handles entity-encoded HTML after decoding', () => {
    expect(htmlToText(decodeEntities('&lt;p&gt;Tom &amp;amp; Jerry&lt;/p&gt;'))).toBe(
      'Tom & Jerry',
    );
  });

  it('drops hidden elements, keeps <header> text and does not bullet <link>', () => {
    expect(
      htmlToText(
        '<HEAD><title>t</title></HEAD><SCRIPT type="x">bad()</SCRIPT ><header>Acme</header><link rel="x"><p>Hi</p>',
      ),
    ).toBe('Acme Hi');
  });

  it('stays linear on broken or hostile HTML', () => {
    const started = performance.now();
    htmlToText('<'.repeat(200_000));
    htmlToText('<script>'.repeat(25_000));
    htmlToText('<style x'.repeat(25_000));
    htmlToText('<li'.repeat(50_000));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('decodes numeric entities', () => {
    expect(decodeEntities('caf&#233; &#x2014; ok')).toBe('café — ok');
  });
});

describe('truncate', () => {
  it('adds an ellipsis only when needed', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a long sentence here', 8)).toBe('a long…');
  });
});
