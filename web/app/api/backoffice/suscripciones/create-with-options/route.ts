import { fromUnknownError, success } from "@/lib/api/response";
import { readJson } from "@/lib/api/validation";
import { createSubscriptionWithOptions } from "@/lib/services/backoffice";

export async function POST(request: Request) {
  try {
    const payload = await readJson<Record<string, unknown>>(request);
    const data = await createSubscriptionWithOptions(payload);
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}

