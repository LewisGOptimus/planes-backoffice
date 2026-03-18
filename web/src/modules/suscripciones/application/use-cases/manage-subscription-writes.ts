import {
  SubscriptionConflictError,
  SubscriptionNotFoundError,
  SubscriptionValidationError,
} from '@/src/modules/suscripciones/application/errors/subscription-application-errors';
import { PrepareUpdateSubscriptionPayloadResult } from '@/src/modules/suscripciones/application/types/subscription-command-types';
import {
  normalizeBillingCycle,
  toNullableDateString,
  toTrimmedString,
} from '@/src/modules/suscripciones/application/use-cases/subscription-payload-utils';
import { DateTimeProviderPort } from '@/src/modules/suscripciones/domain/ports/date-time-provider-port';
import {
  GraceEventRecord,
  SubscriptionRepositoryPort,
} from '@/src/modules/suscripciones/domain/ports/subscription-repository-port';

function assertValidPlanChangeReason(reason: string): void {
  if (reason === 'NUEVO_PLAN' || reason === 'RENOVACION' || reason === 'CAMBIO_PLAN') {
    return;
  }

  throw new SubscriptionValidationError('motivo_cambio_plan must be NUEVO_PLAN, RENOVACION or CAMBIO_PLAN');
}

function assertValidOperationalStatus(status: string): void {
  if (status === '' || status === 'EN_SERVICIO' || status === 'EN_PRORROGA' || status === 'BLOQUEADA') {
    return;
  }

  throw new SubscriptionValidationError('operational_status must be EN_SERVICIO, EN_PRORROGA or BLOQUEADA');
}

function toGraceEvents(beforeGraceUntil: string | null, afterGraceUntil: string | null): GraceEventRecord[] {
  if (!beforeGraceUntil && afterGraceUntil) {
    return [{ type: 'GRACE_GRANTED', payload: { grace_until: afterGraceUntil } }];
  }

  if (beforeGraceUntil && afterGraceUntil && beforeGraceUntil !== afterGraceUntil) {
    return [{ type: 'GRACE_EXTENDED', payload: { from: beforeGraceUntil, to: afterGraceUntil } }];
  }

  if (beforeGraceUntil && !afterGraceUntil) {
    return [{ type: 'GRACE_EXPIRED', payload: { previous_grace_until: beforeGraceUntil } }];
  }

  return [];
}

async function ensureCreateRules(
  repository: SubscriptionRepositoryPort,
  payload: Record<string, unknown>,
  operationDate: string,
): Promise<void> {
  const companyId = toTrimmedString(payload.empresa_id);
  const status = toTrimmedString(payload.estado);

  if (companyId && status === 'ACTIVA') {
    const existingActiveId = await repository.findActiveSubscriptionByCompany(companyId);
    if (existingActiveId) {
      throw new SubscriptionConflictError('Company already has an active subscription');
    }
  }

  const planId = toTrimmedString(payload.plan_id);
  const planPriceId = toTrimmedString(payload.precio_plan_id);
  if (!planId || !planPriceId) {
    return;
  }

  const planPrice = await repository.findPlanPriceById(planPriceId);
  if (!planPrice) {
    throw new SubscriptionValidationError('precio_plan_id not found');
  }

  if (planPrice.planId !== planId) {
    throw new SubscriptionValidationError('precio_plan_id does not belong to plan_id');
  }

  if (!planPrice.activo) {
    throw new SubscriptionValidationError('precio_plan_id is inactive');
  }

  if ((planPrice.validoDesde && planPrice.validoDesde > operationDate) || (planPrice.validoHasta && planPrice.validoHasta < operationDate)) {
    throw new SubscriptionValidationError('precio_plan_id is not valid for operation date');
  }

  const billingCycle = String(payload.billing_cycle ?? payload.periodo ?? planPrice.periodo);
  if (billingCycle !== planPrice.periodo) {
    throw new SubscriptionValidationError('billing_cycle does not match precio_plan period');
  }
}

async function ensurePatchRules(
  repository: SubscriptionRepositoryPort,
  dateTimeProvider: DateTimeProviderPort,
  subscriptionId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const currentSubscription = await repository.findSubscriptionById(subscriptionId);
  if (!currentSubscription) {
    throw new SubscriptionNotFoundError('suscripciones not found');
  }

  const companyId = toTrimmedString(payload.empresa_id) || currentSubscription.empresaId;
  const targetStatus = toTrimmedString(payload.estado) || currentSubscription.estado;
  if (targetStatus === 'ACTIVA') {
    const existingActiveId = await repository.findActiveSubscriptionByCompany(companyId, subscriptionId);
    if (existingActiveId) {
      throw new SubscriptionConflictError('Company already has an active subscription');
    }
  }

  const nextPlanId = toTrimmedString(payload.plan_id) || currentSubscription.planId;
  const nextBillingCycle =
    toTrimmedString(payload.billing_cycle) ||
    toTrimmedString(payload.periodo) ||
    currentSubscription.billingCycle ||
    currentSubscription.periodo;

  const planChanged = nextPlanId !== currentSubscription.planId;
  const cycleChanged = nextBillingCycle !== currentSubscription.billingCycle;
  const requiresPlanWindowUpdate = planChanged || cycleChanged;

  if (requiresPlanWindowUpdate) {
    const startDate = toTrimmedString(payload.periodo_actual_inicio) || toTrimmedString(payload.fecha_inicio);
    if (!startDate) {
      throw new SubscriptionValidationError('periodo_actual_inicio is required when changing plan or billing_cycle');
    }

    payload.periodo_actual_inicio = startDate;

    if (!toTrimmedString(payload.periodo_actual_fin)) {
      const monthsByCycle: Record<string, number> = { ANUAL: 12, TRIMESTRAL: 3 };
      const cycleMonths = monthsByCycle[nextBillingCycle] ?? 1;
      payload.periodo_actual_fin = dateTimeProvider.addMonths(startDate, cycleMonths);
    }
  }

  const operationDate =
    toTrimmedString(payload.periodo_actual_inicio) ||
    toTrimmedString(payload.fecha_inicio) ||
    currentSubscription.fechaInicio ||
    dateTimeProvider.getCurrentIsoDate();

  if (!payload.precio_plan_id && requiresPlanWindowUpdate) {
    const inferredPlanPriceId = await repository.findLatestValidPlanPrice(nextPlanId, nextBillingCycle, operationDate);
    if (!inferredPlanPriceId) {
      throw new SubscriptionValidationError('No active precio_plan_id found for selected plan/cycle/date');
    }

    payload.precio_plan_id = inferredPlanPriceId;
  }

  const nextPlanPriceId = toTrimmedString(payload.precio_plan_id) || (currentSubscription.precioPlanId ?? '');
  if (!nextPlanPriceId) {
    return;
  }

  const planPrice = await repository.findPlanPriceById(nextPlanPriceId);
  if (!planPrice) {
    throw new SubscriptionValidationError('precio_plan_id not found');
  }

  if (planPrice.planId !== nextPlanId) {
    throw new SubscriptionValidationError('precio_plan_id does not belong to plan');
  }

  if (!planPrice.activo) {
    throw new SubscriptionValidationError('precio_plan_id is inactive');
  }

  if ((planPrice.validoDesde && planPrice.validoDesde > operationDate) || (planPrice.validoHasta && planPrice.validoHasta < operationDate)) {
    throw new SubscriptionValidationError('precio_plan_id is not valid for operation date');
  }

  if (nextBillingCycle !== planPrice.periodo) {
    throw new SubscriptionValidationError('billing_cycle does not match precio_plan period');
  }
}

async function ensureGraceRules(
  repository: SubscriptionRepositoryPort,
  dateTimeProvider: DateTimeProviderPort,
  payload: Record<string, unknown>,
  subscriptionId?: string,
): Promise<void> {
  const rawOperationalStatus = toTrimmedString(payload.operational_status);
  assertValidOperationalStatus(rawOperationalStatus);

  const graceUntil = toNullableDateString(payload.grace_until);
  const rawGraceDays = payload.grace_days_granted;
  const hasGraceDays = rawGraceDays !== undefined && rawGraceDays !== null && String(rawGraceDays).trim() !== '';
  const graceDays = hasGraceDays ? Number(rawGraceDays) : null;

  if (graceDays !== null && (!Number.isFinite(graceDays) || graceDays < 0)) {
    throw new SubscriptionValidationError('grace_days_granted must be >= 0');
  }

  let effectiveStatus = toTrimmedString(payload.estado);
  if (subscriptionId) {
    const currentSubscription = await repository.findSubscriptionById(subscriptionId);
    if (!currentSubscription) {
      throw new SubscriptionNotFoundError('suscripciones not found');
    }

    effectiveStatus = currentSubscription.estado;
  }

  if (!effectiveStatus) {
    return;
  }

  const hasGraceConfig = Boolean(graceUntil || rawOperationalStatus === 'EN_PRORROGA' || (graceDays ?? 0) > 0);
  if (hasGraceConfig && effectiveStatus !== 'ACTIVA' && effectiveStatus !== 'PAUSADA') {
    throw new SubscriptionValidationError('Grace period is only allowed for ACTIVA or PAUSADA subscriptions');
  }

  if (graceDays === null) {
    return;
  }

  payload.grace_days_granted = graceDays;
  if (graceDays === 0) {
    payload.grace_until = null;
    if (!rawOperationalStatus) {
      payload.operational_status = 'EN_SERVICIO';
    }
    return;
  }

  const effectivePeriodEnd = subscriptionId
    ? (await repository.findSubscriptionById(subscriptionId))?.periodoActualFin ?? null
    : toTrimmedString(payload.periodo_actual_fin) || null;

  if (!effectivePeriodEnd) {
    throw new SubscriptionValidationError('periodo_actual_fin is required to calculate grace_until');
  }

  payload.grace_until = dateTimeProvider.addDays(effectivePeriodEnd, graceDays);
  payload.operational_status = 'EN_PRORROGA';
}

function evaluatePatchHistory(
  payload: Record<string, unknown>,
  previousStatus: string,
  previousPlanId: string,
  previousBillingCycle: string,
): { historyUpdateReason: string | null; historyUpdateEndDate: string | null } {
  const nextStatus = toTrimmedString(payload.estado) || previousStatus;
  const nextPlanId = toTrimmedString(payload.plan_id) || previousPlanId;
  const nextBillingCycle = toTrimmedString(payload.billing_cycle) || previousBillingCycle;
  const planOrCycleChanged = previousPlanId !== nextPlanId || previousBillingCycle !== nextBillingCycle;

  const planChangeReason = toTrimmedString(payload.motivo_cambio_plan);
  const previousPlanEnd = toNullableDateString(payload.fecha_fin_plan_anterior);
  delete payload.motivo_cambio_plan;
  delete payload.fecha_fin_plan_anterior;

  if (!planOrCycleChanged) {
    return { historyUpdateReason: null, historyUpdateEndDate: null };
  }

  if (!planChangeReason) {
    throw new SubscriptionValidationError('motivo_cambio_plan is required when changing plan or billing_cycle');
  }

  assertValidPlanChangeReason(planChangeReason);

  if (!previousPlanEnd) {
    throw new SubscriptionValidationError('fecha_fin_plan_anterior is required when changing plan or billing_cycle');
  }

  const newPlanStart = toNullableDateString(payload.periodo_actual_inicio) || toNullableDateString(payload.fecha_inicio);
  if (newPlanStart && previousPlanEnd > newPlanStart) {
    throw new SubscriptionValidationError('fecha_fin_plan_anterior cannot be greater than periodo_actual_inicio');
  }

  if (previousStatus !== 'CANCELADA' && nextStatus === 'CANCELADA') {
    return { historyUpdateReason: planChangeReason, historyUpdateEndDate: previousPlanEnd };
  }

  return { historyUpdateReason: planChangeReason, historyUpdateEndDate: previousPlanEnd };
}

export async function prepareCreateSubscriptionPayload(
  repository: SubscriptionRepositoryPort,
  dateTimeProvider: DateTimeProviderPort,
  payload: Record<string, unknown>,
): Promise<void> {
  normalizeBillingCycle(payload);

  const operationDate =
    toTrimmedString(payload.fecha_inicio) ||
    toTrimmedString(payload.periodo_actual_inicio) ||
    dateTimeProvider.getCurrentIsoDate();

  await ensureCreateRules(repository, payload, operationDate);
  await ensureGraceRules(repository, dateTimeProvider, payload);
}

export async function prepareUpdateSubscriptionPayload(
  repository: SubscriptionRepositoryPort,
  dateTimeProvider: DateTimeProviderPort,
  subscriptionId: string,
  payload: Record<string, unknown>,
): Promise<PrepareUpdateSubscriptionPayloadResult> {
  normalizeBillingCycle(payload);

  const currentSubscription = await repository.findSubscriptionById(subscriptionId);
  if (!currentSubscription) {
    throw new SubscriptionNotFoundError('suscripciones not found');
  }

  await ensurePatchRules(repository, dateTimeProvider, subscriptionId, payload);
  await ensureGraceRules(repository, dateTimeProvider, payload, subscriptionId);

  const historyContext = evaluatePatchHistory(
    payload,
    currentSubscription.estado,
    currentSubscription.planId,
    currentSubscription.billingCycle,
  );

  const cancellationReason = toTrimmedString(payload.motivo_cancelacion);
  delete payload.motivo_cancelacion;
  const nextStatus = toTrimmedString(payload.estado) || currentSubscription.estado;

  if (currentSubscription.estado !== 'CANCELADA' && nextStatus === 'CANCELADA') {
    if (!cancellationReason) {
      throw new SubscriptionValidationError('motivo_cancelacion is required when setting estado to CANCELADA');
    }

    if (!payload.canceled_at) {
      payload.canceled_at = dateTimeProvider.getCurrentIsoDateTime();
    }
  }

  return {
    previousStatus: currentSubscription.estado,
    previousGraceUntil: currentSubscription.graceUntil,
    nextStatus,
    historyUpdateReason: historyContext.historyUpdateReason,
    historyUpdateEndDate: historyContext.historyUpdateEndDate,
  };
}

export async function handleAfterCreateSubscription(
  repository: SubscriptionRepositoryPort,
  createdRow: Record<string, unknown>,
): Promise<void> {
  const subscriptionId = toTrimmedString(createdRow.id);
  const planId = toTrimmedString(createdRow.plan_id);
  const periodStart = toTrimmedString(createdRow.periodo_actual_inicio);
  const periodEnd = toTrimmedString(createdRow.periodo_actual_fin);

  if (!subscriptionId || !planId || !periodStart || !periodEnd) {
    return;
  }

  await repository.syncPlanItems(subscriptionId, planId, periodStart, periodEnd);
}

export async function handleAfterUpdateSubscription(
  repository: SubscriptionRepositoryPort,
  dateTimeProvider: DateTimeProviderPort,
  subscriptionId: string,
  previousStatus: string,
  previousGraceUntil: string | null,
  nextStatus: string,
  historyUpdateReason: string | null,
  historyUpdateEndDate: string | null,
  updatedRow: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  if (historyUpdateReason && historyUpdateEndDate) {
    await repository.updateLatestClosedHistoryEndDate(subscriptionId, historyUpdateEndDate);
    await repository.updateOpenHistoryReason(subscriptionId, historyUpdateReason);
  }

  if (previousStatus !== 'CANCELADA' && nextStatus === 'CANCELADA') {
    const cancellationReason = toTrimmedString(payload.motivo_cancelacion);
    const canceledAt = toTrimmedString(updatedRow.canceled_at) || toTrimmedString(payload.canceled_at);
    const cancellationDate = canceledAt ? canceledAt.slice(0, 10) : dateTimeProvider.getCurrentIsoDate();
    const historyReason = cancellationReason ? `CANCELADA: ${cancellationReason}` : 'CANCELADA';

    const updatedRows = await repository.closeOpenHistoryWithReason(subscriptionId, historyReason, cancellationDate);
    if (updatedRows === 0) {
      await repository.upsertClosedHistoryFromSubscription(subscriptionId, historyReason, cancellationDate);
    }
  }

  const beforeGrace = previousGraceUntil;
  const afterGrace = toNullableDateString(updatedRow.grace_until);
  const events = toGraceEvents(beforeGrace, afterGrace);

  for (const event of events) {
    await repository.insertSubscriptionGraceEvent(subscriptionId, event.type, event.payload);
  }
}

export async function validateDeleteSubscriptionRequest(
  repository: SubscriptionRepositoryPort,
  dateTimeProvider: DateTimeProviderPort,
  subscriptionId: string,
  deleteReason: string,
): Promise<void> {
  const trimmedReason = toTrimmedString(deleteReason);
  if (!trimmedReason) {
    throw new SubscriptionValidationError('motivo is required to delete a suscripcion');
  }

  await repository.closeOpenHistoryWithReason(
    subscriptionId,
    `ELIMINADA: ${trimmedReason}`,
    dateTimeProvider.getCurrentIsoDate(),
  );
}
