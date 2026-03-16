import { fromUnknownError, success } from "@/lib/api/response";
import { readJson } from "@/lib/api/validation";
import { patchAlert } from "@/lib/services/billing-v2";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const payload = await readJson<Record<string, unknown>>(request);
    const { id } = await context.params;
    const data = await patchAlert(id, payload);
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
