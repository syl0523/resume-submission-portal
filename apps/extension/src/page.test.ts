// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectPage } from './page';

// Synthetic markup shaped like the real sites; no real postings.
function page(html: string): Document {
  const doc = document.implementation.createHTMLDocument('');
  doc.documentElement.innerHTML = html;
  return doc;
}

describe('collectPage', () => {
  it('collects JSON-LD, metadata and the heading, skipping broken blocks', () => {
    const snapshot = collectPage(
      page(`<head><title>HR Generalist - Northwind</title>
        <meta property="og:site_name" content="Northwind Freight">
        <meta name="description" content="Join us">
        <meta name="viewport" content="width=device-width">
        <script type="application/ld+json">{"@type":"JobPosting","title":"HR Generalist"}</script>
        <script type="application/ld+json">{ not json</script></head>
        <body><h1>  HR
          Generalist </h1></body>`),
      'https://careers.northwind.example/jobs/1',
    );
    expect(snapshot).toEqual({
      url: 'https://careers.northwind.example/jobs/1',
      title: 'HR Generalist - Northwind',
      jsonLd: [{ '@type': 'JobPosting', title: 'HR Generalist' }],
      meta: { 'og:site_name': 'Northwind Freight', description: 'Join us' },
      h1: 'HR Generalist',
      board: null,
      selection: null,
    });
  });

  it('reads the LinkedIn job pane', () => {
    const snapshot = collectPage(
      page(`<body>
        <div class="job-details-jobs-unified-top-card__job-title"><h1>Recruiting Coordinator</h1></div>
        <div class="job-details-jobs-unified-top-card__company-name"><a>Contoso</a></div>
        <div class="job-details-jobs-unified-top-card__primary-description-container">
          <span class="tvm__text">Remote</span><span class="tvm__text">2 days ago</span>
        </div>
        <div id="job-details">Coordinate interviews.\n\n\n\nSchedule panels.</div></body>`),
      'https://www.linkedin.com/jobs/view/4012345678/',
    );
    expect(snapshot.board).toEqual({
      title: 'Recruiting Coordinator',
      company: 'Contoso',
      location: 'Remote',
      description: 'Coordinate interviews.\n\nSchedule panels.',
    });
  });

  it('reads the Indeed job pane without the "- job post" suffix', () => {
    const snapshot = collectPage(
      page(`<body>
        <h1 data-testid="jobsearch-JobInfoHeader-title">Benefits Specialist - job post</h1>
        <div data-testid="inlineHeader-companyName">Fabrikam</div>
        <div data-testid="inlineHeader-companyLocation">Austin, TX</div>
        <div id="jobDescriptionText">Run open enrollment.</div></body>`),
      'https://www.indeed.com/viewjob?jk=abc123',
    );
    expect(snapshot.board).toEqual({
      title: 'Benefits Specialist',
      company: 'Fabrikam',
      location: 'Austin, TX',
      description: 'Run open enrollment.',
    });
  });
});
