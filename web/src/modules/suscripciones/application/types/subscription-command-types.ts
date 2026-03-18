export type PrepareUpdateSubscriptionPayloadResult = {
  previousStatus: string;
  previousGraceUntil: string | null;
  nextStatus: string;
  historyUpdateReason: string | null;
  historyUpdateEndDate: string | null;
};

export type SubscriptionChangeContext = {
  subscriptionId: string;
  payload: Record<string, unknown>;
};
