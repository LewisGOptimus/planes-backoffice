import { fromUnknownError, success } from "@/lib/api/response";
import { getEmpresaCards } from "@/lib/services/backoffice";

export async function GET() {
  try {
    const data = await getEmpresaCards();
    return success(data, { count: data.length });
  } catch (error) {
    return fromUnknownError(error);
  }
}

