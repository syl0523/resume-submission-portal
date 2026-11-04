/** A decoded email, from postal-mime (Email Worker) or pasted into the Inbox page. */
export interface EmailMessage {
  /** Raw From value: `"LinkedIn <jobs-noreply@linkedin.com>"` or a bare address. */
  from: string;
  to?: string | null;
  subject: string;
  text?: string | null;
  html?: string | null;
  /** ISO-8601 or RFC 2822 date string. */
  date?: string | null;
  /** Header map with lower-cased names. */
  headers?: Record<string, string>;
}

export interface EmailAddress {
  name: string | null;
  address: string;
}
