import type { CollectionIssue } from "../../contracts";

export type CollectionIssueCode = CollectionIssue["code"];

export class CollectorError extends Error {
  readonly code: CollectionIssueCode;
  readonly retryable: boolean;

  constructor(
    code: CollectionIssueCode,
    message: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CollectorError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
