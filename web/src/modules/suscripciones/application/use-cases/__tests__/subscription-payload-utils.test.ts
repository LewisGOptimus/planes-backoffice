import { describe, expect, it } from 'vitest';
import { normalizeBillingCycle, toNullableDateString, toTrimmedString } from '../subscription-payload-utils';

describe('subscription-payload-utils', () => {
  it('normalizes billing_cycle from periodo', () => {
    const payload: Record<string, unknown> = { periodo: 'MENSUAL' };
    normalizeBillingCycle(payload);
    expect(payload.billing_cycle).toBe('MENSUAL');
  });

  it('normalizes periodo from billing_cycle', () => {
    const payload: Record<string, unknown> = { billing_cycle: 'ANUAL' };
    normalizeBillingCycle(payload);
    expect(payload.periodo).toBe('ANUAL');
  });

  it('trims string values safely', () => {
    expect(toTrimmedString('  hola  ')).toBe('hola');
    expect(toTrimmedString(10)).toBe('');
  });

  it('converts empty value to nullable date string', () => {
    expect(toNullableDateString('')).toBeNull();
    expect(toNullableDateString('2026-03-18')).toBe('2026-03-18');
  });
});