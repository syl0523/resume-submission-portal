export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}

/** Thrown by the board and search clients when an upstream API fails or returns an unexpected shape. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}
