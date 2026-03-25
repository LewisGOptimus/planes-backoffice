import { fromUnknownError, success } from "@/lib/api/response";
import { getPublicProductByIdentifier } from "@/lib/services/product-catalog";

type RouteContext = {
  params: Promise<{ identifier: string }> | { identifier: string };
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const data = await getPublicProductByIdentifier(params.identifier, new URL(request.url).searchParams);
    return success(data);
  } catch (error) {
    return fromUnknownError(error);
  }
}
