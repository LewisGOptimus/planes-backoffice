import { fromUnknownError, success } from "@/lib/api/response";
import { getEmpresaEntitlements } from "@/lib/services/backoffice";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const data = await getEmpresaEntitlements(id);
    return success(data, { count: data.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}

