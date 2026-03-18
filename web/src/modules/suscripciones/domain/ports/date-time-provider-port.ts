export type DateTimeProviderPort = {
  getCurrentIsoDate(): string;
  getCurrentIsoDateTime(): string;
  addMonths(isoDate: string, months: number): string;
  addDays(isoDate: string, days: number): string;
};