import { describe, expect, it } from 'vitest';
import { prepareCreateSubscriptionPayload } from '../manage-subscription-writes';
import { DateTimeProviderPort } from '../../../domain/ports/date-time-provider-port';
import { SubscriptionRepositoryPort } from '../../../domain/ports/subscription-repository-port';

function buildRepositoryStub(overrides: Partial<SubscriptionRepositoryPort> = {}): SubscriptionRepositoryPort {
  return {
    findActiveSubscriptionByCompany: async () => null,
    findSubscriptionById: async () => null,
    findPlanPriceById: async () => null,
    findLatestValidPlanPrice: async () => null,
    insertSubscriptionGraceEvent: async () => undefined,
    closeOpenHistoryWithReason: async () => 0,
    upsertClosedHistoryFromSubscription: async () => undefined,
    updateLatestClosedHistoryEndDate: async () => undefined,
    updateOpenHistoryReason: async () => undefined,
    syncPlanItems: async () => undefined,
    ...overrides,
  };
}

const dateTimeProviderStub: DateTimeProviderPort = {
  getCurrentIsoDate: () => '2026-03-18',
  getCurrentIsoDateTime: () => '2026-03-18T00:00:00.000Z',
  addMonths: () => '2026-04-18',
  addDays: () => '2026-03-25',
};

describe('prepareCreateSubscriptionPayload', () => {
  it('throws when company already has active subscription', async () => {
    const repository = buildRepositoryStub({
      findActiveSubscriptionByCompany: async () => 'existing-id',
    });

    await expect(
      prepareCreateSubscriptionPayload(repository, dateTimeProviderStub, {
        empresa_id: 'company-1',
        estado: 'ACTIVA',
      }),
    ).rejects.toThrow('Company already has an active subscription');
  });

  it('infers period mirror values for billing_cycle', async () => {
    const repository = buildRepositoryStub();
    const payload: Record<string, unknown> = {
      empresa_id: 'company-1',
      estado: 'PAUSADA',
      periodo: 'MENSUAL',
    };

    await prepareCreateSubscriptionPayload(repository, dateTimeProviderStub, payload);
    expect(payload.billing_cycle).toBe('MENSUAL');
  });
});
