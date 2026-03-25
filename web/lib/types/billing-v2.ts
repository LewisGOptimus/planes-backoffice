export type BillingAction =
  | "create_subscription"
  | "create_deferred_installment_plan"
  | "renew_subscription"
  | "upgrade_midcycle_limit"
  | "purchase_consumable"
  | "purchase_fixed_term_service"
  | "pay_deferred_installment"
  | "add_company_with_subscription"
  | "update_plan_prices";

export type ImpactLine = {
  label: string;
  amount: number;
  billing_date: string;
  effective_start: string | null;
  effective_end: string | null;
  notes?: string;
};

export type ImpactPreviewResponse = {
  action: BillingAction;
  currency: string;
  summary: string;
  lines: ImpactLine[];
  totals: {
    subtotal: number;
    discount: number;
    total: number;
  };
  warnings: string[];
};

export type BillingTimelineEvent = {
  id: string;
  event_type: string;
  event_time: string;
  actor_user_id: string | null;
  related_invoice_id: string | null;
  related_workflow: string | null;
  payload_json: Record<string, unknown>;
};

export type CustomerSearchItem = {
  customer_id: string;
  nombre: string;
  nit: string | null;
  primary_contact: string | null;
  active_subscription_id: string | null;
  subscription_status: string | null;
  renewal_date: string | null;
};

export type Customer360Response = {
  customer: {
    id: string;
    nombre: string;
    nit: string | null;
    timezone: string;
  };
  active_subscription: {
    id: string;
    plan_id: string;
    plan_name: string;
    status: string;
    period: string;
    period_start: string;
    period_end: string;
  } | null;
  invoices: Array<{
    id: string;
    issue_date: string;
    due_date: string | null;
    total: number;
    status: string;
    payment_method: string;
  }>;
  consumption: Array<{
    product_name: string;
    consumed: number;
    remaining: number;
    period_start: string;
    period_end: string;
  }>;
  alerts: Array<{
    id: string;
    alert_type: string;
    severity: string;
    status: string;
    due_at: string | null;
  }>;
  kpis: {
    open_invoices: number;
    open_invoice_amount: number;
    next_renewal_date: string | null;
  };
  deferred_installments: {
    agreement_status: string | null;
    next_installment_due: string | null;
    overdue_installments: number;
    overdue_installment_amount: number;
  } | null;
};

export type PriceBookVersion = {
  id: string;
  plan_id: string;
  plan_name: string;
  period: string;
  value: number;
  currency_code: string;
  active: boolean;
  valid_from: string | null;
  valid_to: string | null;
};

export type BillingAlert = {
  id: string;
  alert_type: string;
  severity: string;
  status: string;
  empresa_id: string;
  suscripcion_id: string | null;
  created_at: string;
  due_at: string | null;
  assigned_to: string | null;
  snapshot_json: Record<string, unknown>;
};

export type OperationsDashboardResponse = {
  generated_at: string;
  kpis: {
    renewals_next_30_days: number;
    overdue_subscriptions: number;
    unpaid_invoices: number;
    overdue_installments: number;
  };
  queue: BillingAlert[];
};
