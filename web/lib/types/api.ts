export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE_VIOLATION"
  | "INTERNAL_ERROR"
  | "UNAUTHORIZED";

export type ApiErrorPayload = {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
};

export type ApiSuccessPayload<T> = {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiResult<T> = ApiSuccessPayload<T> | ApiErrorPayload;

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
