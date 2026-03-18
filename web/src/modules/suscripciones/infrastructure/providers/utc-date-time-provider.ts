import { DateTimeProviderPort } from '@/src/modules/suscripciones/domain/ports/date-time-provider-port';

export class UtcDateTimeProvider implements DateTimeProviderPort {
  getCurrentIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  getCurrentIsoDateTime(): string {
    return new Date().toISOString();
  }

  addMonths(isoDate: string, months: number): string {
    const date = new Date(`${isoDate}T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() + months);
    return date.toISOString().slice(0, 10);
  }

  addDays(isoDate: string, days: number): string {
    const date = new Date(`${isoDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
}