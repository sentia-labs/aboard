export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export type AboardError = ValidationError | NotFoundError | ConflictError;

export function isAboardError(err: unknown): err is AboardError {
  return (
    err instanceof ValidationError ||
    err instanceof NotFoundError ||
    err instanceof ConflictError
  );
}
