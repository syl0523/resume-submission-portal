import type { JobDraft } from '@jsp/core';

/**
 * Build a job draft from schema.org JobPosting JSON-LD found on a page
 * (most job sites embed it for Google for Jobs).
 *
 * `blocks` are the parsed contents of every `<script type="application/ld+json">` on the page.
 *
 * TODO(extension agent): implement. Handle arrays and @graph, hiringOrganization,
 * jobLocation / applicantLocationRequirements, jobLocationType TELECOMMUTE, baseSalary,
 * employmentType, datePosted, identifier and HTML descriptions.
 */
export function jobFromJsonLd(blocks: unknown[], pageUrl: string): JobDraft | null {
  void blocks;
  void pageUrl;
  return null;
}
