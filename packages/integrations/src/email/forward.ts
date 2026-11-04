import { emailBodyText, normalizeEmailDate } from './basics';
import type { EmailMessage } from './types';

/**
 * Manual forwards: the user forwards an application email from Outlook/Hotmail, Gmail or Apple
 * Mail to their portal address. The original sender, subject and date sit in an inline header
 * block; recover them so classification sees the employer's email, not the user's forward.
 */

const FORWARD_SUBJECT = /^\s*(fw|fwd|tr|wg|rv|转发|轉寄|轉發)\s*[:：]/i;

const MARKER_LINE = [
  /^-{2,}\s*(forwarded message|original message|转发的邮件|轉寄的郵件|转发邮件|原始邮件|原始郵件|message transféré|weitergeleitete nachricht|mensaje reenviado)\s*-{2,}$/i,
  /^-{3,}\s*original message\s*-{3,}$/i,
  /^(begin forwarded message|以下为转发的邮件|以下是转发的邮件|下面是被转发的邮件|開始轉寄的郵件)\s*[:：]?$/i,
  /^_{8,}$/,
];

type Field = 'from' | 'subject' | 'date' | 'to' | 'cc';

const LABELS: [Field, RegExp][] = [
  ['from', /^(from|发件人|發件人|寄件者|寄件人|de|von|van)$/i],
  ['subject', /^(subject|主题|主題|主旨|标题|標題|objet|betreff|asunto|onderwerp|oggetto)$/i],
  [
    'date',
    /^(date|sent|发送时间|發送時間|日期|时间|時間|envoyé|gesendet|enviado|fecha|datum|data)$/i,
  ],
  ['to', /^(to|收件人|收件者|à|an|para|aan|a)$/i],
  ['cc', /^(cc|抄送|副本|cópia)$/i],
];

const HEADER_LINE = /^\s*[*>]*\s*([A-Za-zÀ-ÿ一-鿿 ]{1,20}?)\s*[*]*\s*[:：]\s*(.*)$/;

function labelOf(line: string): { field: Field; value: string } | null {
  const m = HEADER_LINE.exec(line);
  if (!m?.[1]) return null;
  const label = m[1].trim();
  for (const [field, re] of LABELS) {
    if (re.test(label)) return { field, value: (m[2] ?? '').trim() };
  }
  return null;
}

function stripForwardPrefixes(subject: string): string {
  let s = subject.trim();
  for (let i = 0; i < 5 && FORWARD_SUBJECT.test(s); i++) s = s.replace(FORWARD_SUBJECT, '').trim();
  return s;
}

function unwrapOnce(msg: EmailMessage): EmailMessage | null {
  const lines = emailBodyText(msg).split(/\r?\n/);
  const subjectSaysForward = FORWARD_SUBJECT.test(msg.subject);

  let searchFrom = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (MARKER_LINE.some((re) => re.test(line))) {
      searchFrom = i + 1;
      break;
    }
  }
  if (searchFrom < 0 && !subjectSaysForward) return null;

  const start = Math.max(0, searchFrom);
  const end = Math.min(lines.length, searchFrom >= 0 ? searchFrom + 8 : 80);
  let headerStart = -1;
  for (let i = start; i < end; i++) {
    if (labelOf(lines[i] ?? '')?.field !== 'from') continue;
    // A real header block also carries a subject within the next few lines.
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      if (labelOf(lines[j] ?? '')?.field === 'subject') {
        headerStart = i;
        break;
      }
    }
    if (headerStart >= 0) break;
  }
  if (headerStart < 0) return null;

  const fields: Partial<Record<Field, string>> = {};
  let last: Field | null = null;
  let i = headerStart;
  for (; i < Math.min(lines.length, headerStart + 14); i++) {
    const line = lines[i] ?? '';
    if (!line.trim()) break;
    const header = labelOf(line);
    if (header) {
      fields[header.field] = header.value;
      last = header.field;
    } else if (last) {
      fields[last] = `${fields[last] ?? ''} ${line.trim()}`.trim();
    }
  }
  const body = lines.slice(i).join('\n').replace(/^\s+/, '');

  return {
    from: fields.from || msg.from,
    to: fields.to ?? null,
    subject: stripForwardPrefixes(fields.subject ?? msg.subject),
    text: body,
    html: null,
    date: normalizeEmailDate(fields.date) ?? msg.date ?? null,
    headers: {},
  };
}

/**
 * If the message is a manual forward ("FW:"/"Fwd:"/"转发:" or an inline original-message
 * block), return the original message (original From, Subject, Date and body). Nested forwards
 * are unwrapped too. Anything else is returned unchanged.
 */
export function unwrapForwarded(msg: EmailMessage): EmailMessage {
  let current = msg;
  for (let depth = 0; depth < 3; depth++) {
    const inner = unwrapOnce(current);
    if (!inner) break;
    current = inner;
  }
  return current;
}

export function isForwardSubject(subject: string): boolean {
  return FORWARD_SUBJECT.test(subject);
}
