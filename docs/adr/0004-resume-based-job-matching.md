# ADR 0004: Resume-based job matching across sources (US-first)

- Status: accepted (2026-11-03)
- Jira: KAN-37 and children

## Context

The user wants to search "all fitted and possible jobs" from LinkedIn, Indeed and company sites based on the
resume, with a focus on US jobs.

## Decision

- **Saved searches from the resume.** Claude reads the resume (PDF as a document) and drafts a named track:
  target titles (current level, one step up, adjacent roles), skills, seniority, US locations, work mode and a
  summary. The user edits and saves it, and can keep several tracks (e.g. "HR Manager, remote US" and
  "Ops Manager, Texas"), each tied to a resume version. Runs store hits, so "new since last run" is exact.
- **Sources, all optional and parallel:**
  - JSearch (RapidAPI): Google for Jobs listings from LinkedIn, Indeed, Glassdoor, ZipRecruiter and company
    career sites. The broadest single source; third-party, user's own key.
  - Adzuna, US index: official API, broad coverage of company sites and boards.
  - USAJOBS: official US federal jobs API.
  - Watched company boards: official Greenhouse, Lever, Ashby, SmartRecruiters APIs.
  - The Muse (added 2026-11-05, KAN-66): official public API, no key. Category-based, so postings are
    filtered by title locally. Gives a keyless source beyond watched boards.
  - Claude web search (added 2026-11-05, KAN-63): searches employers' own careers sites and ATS boards
    (Google, Microsoft, Amazon, Apple, Meta, Netflix, Salesforce, Uber, Workday, Greenhouse, Lever, Ashby,
    SmartRecruiters) through the Anthropic API's web search tool, restricted with `allowed_domains`. Covers
    the big employers whose own careers sites have no public API. Never LinkedIn or Indeed (ADR 0002); every
    reported URL must be on an allowed site and among the search results. Billed per search, so capped and
    manual-only.
- **Default place (2026-11-05, KAN-65):** the San Francisco Bay Area, as a metro that covers its cities;
  "United States" searches the whole country.
- **Always-available fallback:** pre-filled LinkedIn Jobs, Indeed and Google Jobs search links for every
  title x location in the profile. No keys needed.
- **Ranking:** deterministic `scoreJobFit` (title similarity, skill coverage, work mode/location, salary
  floor, freshness, exclude keywords) on every result, in the Worker and in the extension popup. Optional AI
  re-rank of the top 20 with a one-line reason.
- **Cross-source dedupe:** the same job on LinkedIn, Indeed and the employer's site becomes one hit with the
  employer's own apply link.
- **Work-authorization signals:** postings that say no sponsorship, US citizens only or clearance required are
  flagged, and excluded when the search says sponsorship is needed.
- **Quota safety:** at most `maxQueries` (default 4) queries per provider per manual run, 2 for the weekly cron.

## Consequences

- Useful with zero keys (links, boards, The Muse; AI on Workers AI), better with JSearch/Adzuna/USAJOBS keys,
  best with an Anthropic key (Claude AI and web search).
- Results are as fresh as each source; JSearch quota limits how often a full search can run.
- An email digest of new hits is a follow-up (backlog); new hits show on the dashboard meanwhile.
