# ADR 0003: Email forwarding drives application status

- Status: accepted (2026-11-03)
- Jira: KAN-6, KAN-20, KAN-21, KAN-22

## Context

Every platform emails candidates: confirmations ("Your application was sent to…"), "viewed" notices,
assessments, interview invitations, rejections and offers. No platform offers a status API to candidates.

## Decision

- Each user gets a random inbound address (`jobs-xxxxxxxx@jobs.<domain>`) on Cloudflare Email Routing.
- The user adds one mailbox rule (Outlook/Hotmail "Redirect to", Gmail filter + forward) for job senders.
- The Worker classifies each email with deterministic rules per provider (fast, free, explainable); when
  confidence is below 0.6 and AI is configured, a fast Claude model gives a second opinion.
- Matching uses job ids/URLs first, then company and title similarity; ambiguous emails wait in the Inbox.
- Status changes go through the status engine: automation only moves forward, never out of a final status.
- Confirmations with no matching application create one (captures applications made anywhere).

## Alternatives considered

| Option                                     | Why not (for now)                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail API / Microsoft Graph mailbox access | OAuth app registration per provider; Gmail's restricted scopes need verification beyond personal use; more sensitive access than needed. Planned as an option (KAN-35). |
| IMAP polling                               | Basic auth is disabled on Outlook.com; app passwords are fragile.                                                                                                       |
| Manual status updates only                 | The problem we are solving.                                                                                                                                             |

## Consequences

- Works with any mailbox that can forward, including Hotmail/Outlook.com.
- Rules need upkeep as email templates change; fixtures make regressions visible.
- Without a domain, users can still paste emails into the Inbox.
