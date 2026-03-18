export type SubscriptionRecord = {
  id: string;
  empresaId: string;
  planId: string;
  precioPlanId: string | null;
  periodo: string;
  billingCycle: string;
  fechaInicio: string;
  periodoActualFin: string | null;
  estado: string;
  operationalStatus: string | null;
  graceUntil: string | null;
  canceledAt: string | null;
};

export type PlanPriceRecord = {
  id: string;
  planId: string;
  periodo: string;
  activo: boolean;
  validoDesde: string | null;
  validoHasta: string | null;
};

export type GraceEventRecord = {
  type: string;
  payload: Record<string, unknown>;
};

export type SubscriptionRepositoryPort = {
  findActiveSubscriptionByCompany(companyId: string, excludedSubscriptionId?: string): Promise<string | null>;
  findSubscriptionById(subscriptionId: string): Promise<SubscriptionRecord | null>;
  findPlanPriceById(planPriceId: string): Promise<PlanPriceRecord | null>;
  findLatestValidPlanPrice(planId: string, billingCycle: string, operationDate: string): Promise<string | null>;
  insertSubscriptionGraceEvent(subscriptionId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
  closeOpenHistoryWithReason(subscriptionId: string, reason: string, closeDate: string): Promise<number>;
  upsertClosedHistoryFromSubscription(subscriptionId: string, reason: string, closeDate: string): Promise<void>;
  updateLatestClosedHistoryEndDate(subscriptionId: string, endDate: string): Promise<void>;
  updateOpenHistoryReason(subscriptionId: string, reason: string): Promise<void>;
  syncPlanItems(subscriptionId: string, planId: string, periodStart: string, periodEnd: string): Promise<void>;
};
