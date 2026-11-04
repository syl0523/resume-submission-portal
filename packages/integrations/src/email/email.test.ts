import { describe, expect, it } from 'vitest';
import { classifyEmail, normalizeEmailDate, parseInterviewTime, unwrapForwarded } from './index';
import type { EmailMessage } from './types';

// All fixtures are synthetic: fictional companies, example.com people, made-up job ids.

const msg = (
  from: string,
  subject: string,
  text: string,
  date = '2026-11-10T15:00:00Z',
): EmailMessage => ({
  from,
  subject,
  text,
  date,
});

describe('classifyEmail: providers and kinds', () => {
  it('LinkedIn Easy Apply confirmation', () => {
    const r = classifyEmail(
      msg(
        'LinkedIn <jobs-noreply@linkedin.com>',
        'Jane, your application was sent to Northwind Freight',
        'Your application was sent to Northwind Freight\n\nHR Generalist\nNorthwind Freight · Austin, TX (On-site)\nApplied on October 6, 2026\n\nView job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc%3D%3D&refId=xyz\n',
      ),
    );
    expect(r).toMatchObject({
      provider: 'linkedin',
      kind: 'application_received',
      company: 'Northwind Freight',
      jobTitle: 'HR Generalist',
      jobUrl: 'https://www.linkedin.com/jobs/view/4012345678/',
      externalJobId: '4012345678',
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.signals).toContain('kind:received.sent');
  });

  it('LinkedIn "viewed" notice', () => {
    const r = classifyEmail(
      msg(
        'LinkedIn <jobs-noreply@linkedin.com>',
        'Your application was viewed by Contoso',
        'Good news! Contoso viewed your application.\n\nPeople Operations Manager\nContoso · Remote\n',
      ),
    );
    expect(r).toMatchObject({
      kind: 'application_viewed',
      company: 'Contoso',
      jobTitle: 'People Operations Manager',
    });
  });

  it('LinkedIn rejection', () => {
    const r = classifyEmail(
      msg(
        'LinkedIn <jobs-noreply@linkedin.com>',
        'Your application to Recruiter at Fabrikam',
        'Thank you for your interest in the Recruiter position at Fabrikam. Unfortunately, we will not be moving forward with your application at this time.',
      ),
    );
    expect(r).toMatchObject({ kind: 'rejection', company: 'Fabrikam', jobTitle: 'Recruiter' });
  });

  it('Indeed Apply confirmation', () => {
    const r = classifyEmail(
      msg(
        'Indeed Apply <indeedapply@indeed.com>',
        'Indeed Application: Payroll Specialist',
        'Application submitted\n\nPayroll Specialist\nTailspin Toys - Dallas, TX\n\nThe following items were sent to Tailspin Toys. Good luck!\nhttps://www.indeed.com/viewjob?jk=0123456789abcdef&from=mail',
      ),
    );
    expect(r).toMatchObject({
      provider: 'indeed',
      kind: 'application_received',
      company: 'Tailspin Toys',
      jobTitle: 'Payroll Specialist',
      externalJobId: '0123456789abcdef',
    });
  });

  it('Greenhouse confirmation', () => {
    const r = classifyEmail(
      msg(
        'Wide World Importers <no-reply@us.greenhouse-mail.io>',
        'Thank you for applying to Wide World Importers',
        'Hi Jane,\n\nThank you for applying for the Talent Acquisition Partner position at Wide World Importers. We will review your application and get back to you.\n\nhttps://job-boards.greenhouse.io/wideworld/jobs/4433221',
      ),
    );
    expect(r).toMatchObject({
      provider: 'greenhouse',
      kind: 'application_received',
      company: 'Wide World Importers',
      jobTitle: 'Talent Acquisition Partner',
      externalJobId: '4433221',
    });
  });

  it('Lever rejection', () => {
    const r = classifyEmail(
      msg(
        'Proseware <no-reply@hire.lever.co>',
        'Your application to Proseware',
        'Hi Jane,\n\nThank you for taking the time to apply for the HR Business Partner role at Proseware. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our needs.\n',
      ),
    );
    expect(r).toMatchObject({
      provider: 'lever',
      kind: 'rejection',
      company: 'Proseware',
      jobTitle: 'HR Business Partner',
    });
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('Ashby interview confirmation with a time', () => {
    const r = classifyEmail(
      msg(
        'Litware Recruiting <no-reply@ashbyhq.com>',
        'Interview confirmation: Litware',
        'Hi Jane,\n\nYour interview with Litware for the Senior Recruiter role is confirmed for Tuesday, November 17, 2026 at 2:00 PM EST (45 minutes) via Zoom.\n',
      ),
    );
    expect(r).toMatchObject({
      provider: 'ashby',
      kind: 'interview',
      company: 'Litware',
      jobTitle: 'Senior Recruiter',
      interviewAt: '2026-11-17T19:00:00.000Z',
    });
  });

  it('Workday confirmation names the company from the sender', () => {
    const r = classifyEmail(
      msg(
        'Adventure Works Careers <adventureworks@myworkday.com>',
        'Thank you for applying!',
        'Dear Jane,\n\nThank you for applying to the Benefits Analyst position. We have received your application and will review it shortly.\n\nAdventure Works Talent Acquisition',
      ),
    );
    expect(r).toMatchObject({
      provider: 'workday',
      kind: 'application_received',
      company: 'Adventure Works',
      jobTitle: 'Benefits Analyst',
    });
  });

  it('SmartRecruiters assessment', () => {
    const r = classifyEmail(
      msg(
        'Blue Yonder Airlines <noreply@smartrecruiters.com>',
        'Next step: online assessment for HR Coordinator',
        'Hello Jane,\n\nThank you for your application for the HR Coordinator position at Blue Yonder Airlines. As a next step, please complete the online assessment within 5 days.\n',
      ),
    );
    expect(r).toMatchObject({
      provider: 'smartrecruiters',
      kind: 'assessment',
      company: 'Blue Yonder Airlines',
      jobTitle: 'HR Coordinator',
    });
  });

  it('iCIMS phone screen', () => {
    const r = classifyEmail(
      msg(
        'Coho Winery <careers@coho.icims.com>',
        'Phone screen for Office Manager',
        'Hi Jane,\n\nThanks for applying to Coho Winery. We would like to schedule a phone screen for the Office Manager role. Please pick a time that works for you.',
      ),
    );
    expect(r).toMatchObject({
      provider: 'icims',
      kind: 'screening',
      company: 'Coho Winery',
      jobTitle: 'Office Manager',
    });
  });

  it('Taleo offer', () => {
    const r = classifyEmail(
      msg(
        "Margie's Travel <noreply@margies.taleo.net>",
        "Your offer letter from Margie's Travel",
        'Dear Jane,\n\nCongratulations! We are pleased to extend an offer for the position of Training Specialist. Please review the attached offer letter.',
      ),
    );
    expect(r).toMatchObject({
      provider: 'taleo',
      kind: 'offer',
      company: "Margie's Travel",
      jobTitle: 'Training Specialist',
    });
  });

  it('SuccessFactors confirmation', () => {
    const r = classifyEmail(
      msg(
        'noreply@successfactors.com',
        'Application received - Compensation Analyst',
        'Dear Applicant,\n\nWe have received your application for the Compensation Analyst position at Trey Research. Our team will review it.',
      ),
    );
    expect(r).toMatchObject({
      provider: 'successfactors',
      kind: 'application_received',
      company: 'Trey Research',
      jobTitle: 'Compensation Analyst',
    });
  });

  it('a recruiter writing from the company domain', () => {
    const r = classifyEmail(
      msg(
        'Alex Rivera <alex@relecloud.example>',
        'Interview invitation - Customer Success Manager',
        "Hi Jane,\n\nI'd like to invite you to an interview for the Customer Success Manager role at Relecloud. Are you available on Nov 18 at 10:30 AM PT?",
      ),
    );
    expect(r).toMatchObject({
      provider: 'generic',
      kind: 'interview',
      company: 'Relecloud',
      jobTitle: 'Customer Success Manager',
      interviewAt: '2026-11-18T18:30:00.000Z',
    });
  });

  it('job alerts are confidently "other"', () => {
    const r = classifyEmail(
      msg(
        'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
        '30+ new jobs for "HR Generalist" in Austin',
        'Jobs you may be interested in\n\nHR Generalist\nNorthwind · Austin\n',
      ),
    );
    expect(r.kind).toBe('other');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('unknown mail is "other" with low confidence (AI second opinion territory)', () => {
    const r = classifyEmail(msg('Pat <pat@example.com>', 'Lunch on Friday?', 'Are you free?'));
    expect(r.kind).toBe('other');
    expect(r.confidence).toBeLessThan(0.6);
    expect(r.signals).toContain('kind:no_rule');
  });
});

describe('unwrapForwarded', () => {
  it('Gmail forward of a Greenhouse rejection', () => {
    const forwarded = msg(
      'Jane Doe <jane.doe@example.com>',
      'Fwd: Update on your application',
      'FYI\n\n---------- Forwarded message ---------\nFrom: Northwind Freight <no-reply@us.greenhouse-mail.io>\nDate: Mon, Oct 20, 2026 at 9:14 AM\nSubject: Update on your application\nTo: <jane.doe@example.com>\n\n\nHi Jane,\n\nThank you for your interest in the HR Generalist position at Northwind Freight. Unfortunately, we have decided to move forward with other candidates.\n',
    );
    const original = unwrapForwarded(forwarded);
    expect(original).toMatchObject({
      from: 'Northwind Freight <no-reply@us.greenhouse-mail.io>',
      subject: 'Update on your application',
      date: '2026-10-20T09:14:00.000Z',
    });
    expect(original.text).toMatch(/^Hi Jane,/);
    expect(classifyEmail(original)).toMatchObject({
      provider: 'greenhouse',
      kind: 'rejection',
      company: 'Northwind Freight',
      jobTitle: 'HR Generalist',
    });
  });

  it('Outlook forward with Chinese headers', () => {
    const forwarded = msg(
      'Jane Doe <jane.doe@example.com>',
      '转发: Your application was viewed by Contoso',
      '\n\n________________________________\n发件人: LinkedIn <jobs-noreply@linkedin.com>\n发送时间: 2026年10月21日 14:05\n收件人: jane.doe@example.com <jane.doe@example.com>\n主题: Your application was viewed by Contoso\n\nGood news! Contoso viewed your application.\n\nPeople Operations Manager\nContoso · Remote\n',
    );
    const original = unwrapForwarded(forwarded);
    expect(original).toMatchObject({
      from: 'LinkedIn <jobs-noreply@linkedin.com>',
      subject: 'Your application was viewed by Contoso',
      date: '2026-10-21T14:05:00.000Z',
    });
    expect(classifyEmail(original)).toMatchObject({
      provider: 'linkedin',
      kind: 'application_viewed',
      company: 'Contoso',
    });
  });

  it('Apple Mail forward, nested inside another forward', () => {
    const inner =
      'Begin forwarded message:\n\nFrom: Wide World Importers <no-reply@us.greenhouse-mail.io>\nSubject: Thank you for applying to Wide World Importers\nDate: October 22, 2026 at 8:00:00 AM EDT\nTo: Jane Doe <jane.doe@example.com>\n\nThank you for applying for the Talent Acquisition Partner position at Wide World Importers.\n';
    const forwarded = msg(
      'Jane Doe <jane.doe@example.com>',
      'Fwd: Fwd: Thank you for applying to Wide World Importers',
      `---------- Forwarded message ---------\nFrom: Jane Doe <jane.doe@example.net>\nDate: Thu, Oct 22, 2026 at 1:00 PM\nSubject: Fwd: Thank you for applying to Wide World Importers\nTo: <jane.doe@example.com>\n\n${inner}`,
    );
    const original = unwrapForwarded(forwarded);
    expect(original.from).toBe('Wide World Importers <no-reply@us.greenhouse-mail.io>');
    expect(original.subject).toBe('Thank you for applying to Wide World Importers');
    expect(original.date).toBe('2026-10-22T12:00:00.000Z');
  });

  it('leaves ordinary mail alone, even when it quotes "From:"', () => {
    const plain = msg(
      'Pat <pat@example.com>',
      'Notes',
      'From: the meeting\nSubject: hiring plan\n\nSee you.',
    );
    expect(unwrapForwarded(plain)).toBe(plain);
  });
});

describe('dates and interview times', () => {
  it('normalises forward-header dates', () => {
    expect(normalizeEmailDate('Mon, Oct 20, 2026 at 9:14 AM')).toBe('2026-10-20T09:14:00.000Z');
    expect(normalizeEmailDate('2026年10月6日周一 下午2:30')).toBe('2026-10-06T14:30:00.000Z');
    expect(normalizeEmailDate('Tue, 03 Nov 2026 10:00:00 -0500')).toBe('2026-11-03T15:00:00.000Z');
    expect(normalizeEmailDate('not a date')).toBeNull();
  });

  it('reads interview times with US zones, ranges and Chinese dates', () => {
    expect(parseInterviewTime('on Nov 3 at 9:30 AM ET', '2026-10-20T00:00:00Z')).toBe(
      '2026-11-03T14:30:00.000Z',
    );
    expect(parseInterviewTime('Oct 30, 2026, 2:00 – 2:45 PM (PDT)')).toBe(
      '2026-10-30T21:00:00.000Z',
    );
    expect(parseInterviewTime('11/12/2026 at 10:30 AM PT')).toBe('2026-11-12T18:30:00.000Z');
    expect(parseInterviewTime('时间：2026年11月12日 下午2:00（北京时间）')).toBe(
      '2026-11-12T06:00:00.000Z',
    );
  });

  it('gives up without a date or a zone', () => {
    expect(parseInterviewTime('Friday at 3pm works')).toBeNull();
    expect(parseInterviewTime('November 12 at 2:00 PM')).toBeNull();
  });
});
