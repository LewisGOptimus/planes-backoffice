import { AppError } from '@/lib/api/types';
import {
  SubscriptionConflictError,
  SubscriptionNotFoundError,
  SubscriptionValidationError,
} from '@/src/modules/suscripciones/application/errors/subscription-application-errors';
import {
  handleAfterCreateSubscription,
  handleAfterUpdateSubscription,
  prepareCreateSubscriptionPayload,
  prepareUpdateSubscriptionPayload,
  validateDeleteSubscriptionRequest,
} from '@/src/modules/suscripciones/application/use-cases/manage-subscription-writes';
import { PostgresSubscriptionRepository } from '@/src/modules/suscripciones/infrastructure/persistence/postgres-subscription-repository';
import { UtcDateTimeProvider } from '@/src/modules/suscripciones/infrastructure/providers/utc-date-time-provider';

const repository = new PostgresSubscriptionRepository();
const dateTimeProvider = new UtcDateTimeProvider();

function toAppError(error: unknown): AppError {
  if (error instanceof SubscriptionValidationError) {
    return new AppError(400, 'BUSINESS_RULE_VIOLATION', error.message);
  }

  if (error instanceof SubscriptionConflictError) {
    return new AppError(409, 'CONFLICT', error.message);
  }

  if (error instanceof SubscriptionNotFoundError) {
    return new AppError(404, 'NOT_FOUND', error.message);
  }

  if (error instanceof AppError) {
    return error;
  }

  return new AppError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error');
}

export async function runBeforeSubscriptionCreate(payload: Record<string, unknown>): Promise<void> {
  try {
    await prepareCreateSubscriptionPayload(repository, dateTimeProvider, payload);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function runAfterSubscriptionCreate(createdRow: Record<string, unknown>): Promise<void> {
  try {
    await handleAfterCreateSubscription(repository, createdRow);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function runBeforeSubscriptionPatch(
  subscriptionId: string,
  payload: Record<string, unknown>,
): Promise<{
  previousStatus: string;
  previousGraceUntil: string | null;
  nextStatus: string;
  historyUpdateReason: string | null;
  historyUpdateEndDate: string | null;
}> {
  try {
    return await prepareUpdateSubscriptionPayload(repository, dateTimeProvider, subscriptionId, payload);
  } catch (error) {
    throw toAppError(error);
  }
}

export async function runAfterSubscriptionPatch(
  subscriptionId: string,
  patchContext: {
    previousStatus: string;
    previousGraceUntil: string | null;
    nextStatus: string;
    historyUpdateReason: string | null;
    historyUpdateEndDate: string | null;
  },
  updatedRow: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await handleAfterUpdateSubscription(
      repository,
      dateTimeProvider,
      subscriptionId,
      patchContext.previousStatus,
      patchContext.previousGraceUntil,
      patchContext.nextStatus,
      patchContext.historyUpdateReason,
      patchContext.historyUpdateEndDate,
      updatedRow,
      payload,
    );
  } catch (error) {
    throw toAppError(error);
  }
}

export async function runBeforeSubscriptionDelete(subscriptionId: string, deleteReason: string): Promise<void> {
  try {
    await validateDeleteSubscriptionRequest(repository, dateTimeProvider, subscriptionId, deleteReason);
  } catch (error) {
    throw toAppError(error);
  }
}
