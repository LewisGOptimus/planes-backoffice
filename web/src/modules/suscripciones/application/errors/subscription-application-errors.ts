export class SubscriptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionValidationError';
  }
}

export class SubscriptionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionConflictError';
  }
}

export class SubscriptionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionNotFoundError';
  }
}