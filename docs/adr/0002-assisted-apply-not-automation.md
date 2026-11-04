# ADR 0002: Assisted apply, not automation, on LinkedIn and Indeed

- Status: accepted (2026-11-03)
- Jira: KAN-9, KAN-30, KAN-31

## Context

The goal is to "connect LinkedIn, Indeed, etc. to submit resumes and check status". Neither LinkedIn nor
Indeed offers job seekers an API to submit applications, search jobs or read application status; their
partner APIs are for employers and ATS vendors. Their user agreements prohibit bots, scrapers and automated
applying, and both actively restrict accounts that do it.

## Decision

- **Never automate LinkedIn or Indeed.** No server-side fetching of their pages, no auto-apply, no autofill on
  their sites.
- **Capture** jobs with a browser extension the user clicks on the page they are viewing (activeTab only).
- **Apply** on company ATS forms (Greenhouse, Lever, Ashby) with review-before-submit autofill; the user always
  clicks Submit. EEO/self-identification questions are never filled.
- **Search** LinkedIn/Indeed listings only through a third-party aggregator API (JSearch, Google for Jobs data)
  that the user opts into with their own key, and through plain pre-filled search links.
- **Status** comes from the emails both platforms already send (ADR 0003), plus LinkedIn's own data export.

## Consequences

- The user's LinkedIn and Indeed accounts are never at risk from this tool.
- Applying on LinkedIn Easy Apply / Indeed Apply stays manual (one click to log it).
- Aggregator coverage and freshness depend on Google for Jobs; it is optional and replaceable.
