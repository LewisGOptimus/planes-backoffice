import { fromUnknownError, success } from "@/lib/api/response";
import { getEmpresaConsumablesPool } from "@/lib/services/backoffice";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const data = await getEmpresaConsumablesPool(id);
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}

