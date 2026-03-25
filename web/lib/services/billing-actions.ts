import { AppError } from "@/lib/api/types";
import { BillingAction } from "@/lib/types/billing-v2";

const ACTIONS: BillingAction[] = [
  "create_subscription",
  "create_deferred_installment_plan",
  "renew_subscription",
  "upgrade_midcycle_limit",
  "purchase_consumable",
  "purchase_fixed_term_service",
  "pay_deferred_installment",
  "add_company_with_subscription",
  "update_plan_prices",
];

export function parseBillingAction(input: string): BillingAction {
  if (ACTIONS.includes(input as BillingAction)) return input as BillingAction;
  throw new AppError(404, "NOT_FOUND", "Billing action not found");
}
