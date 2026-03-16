export type WorkflowId =
  | "onboard-legacy-support"
  | "onboard-new-annual"
  | "migrate-from-excel"
  | "accountant-multi-company-subscriptions"
  | "renew-subscription"
  | "update-plan-prices"
  | "purchase-consumable"
  | "add-company-with-subscription"
  | "upgrade-midcycle-limit"
  | "purchase-fixed-term-service";

export type WorkflowDefinition = {
  id: WorkflowId;
  caso: number;
  titulo: string;
  descripcion: string;
  payloadTemplate: Record<string, unknown>;
  camposMinimos: string[];
};
