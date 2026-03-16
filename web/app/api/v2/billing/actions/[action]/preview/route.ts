import { fromUnknownError, success } from "@/lib/api/response";
import { readJson } from "@/lib/api/validation";
import { parseBillingAction } from "@/lib/services/billing-actions";
import { previewAction } from "@/lib/services/billing-v2";

type RouteContext = { params: Promise<{ action: string }> | { action: string } };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { action } = await context.params;
    const payload = await readJson<Record<string, unknown>>(request);
    const data = await previewAction(parseBillingAction(action), payload);
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
