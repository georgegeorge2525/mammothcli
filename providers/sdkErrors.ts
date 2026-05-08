// src/providers/sdkErrors.ts
// Stub runtime error classes mirroring @anthropic-ai/sdk error hierarchy.
// Used by error-handling code that performs instanceof checks against SDK errors.

export class APIError extends Error {
  status?: number;
  headers?: Headers;
  error?: unknown;
  request_id?: string | null;
  constructor(status?: number, error?: unknown, message?: string, headers?: Headers) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.error = error;
    this.headers = headers;
  }
}

export class APIConnectionError extends APIError {
  constructor(message?: string) {
    super(undefined, undefined, message);
    this.name = 'APIConnectionError';
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor(message?: string) {
    super(message);
    this.name = 'APIConnectionTimeoutError';
  }
}

export class NotFoundError extends APIError {
  constructor(message?: string, headers?: Headers) {
    super(404, undefined, message, headers);
    this.name = 'NotFoundError';
  }
}

export class AuthenticationError extends APIError {
  constructor(message?: string, headers?: Headers) {
    super(401, undefined, message, headers);
    this.name = 'AuthenticationError';
  }
}
