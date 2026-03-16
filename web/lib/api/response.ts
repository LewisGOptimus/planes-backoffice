import { NextResponse } from "next/server";
import { ApiSuccessBody, AppError } from "@/lib/api/types";

export function success<T>(data: T, meta?: Record<string, unknown>) {
  return NextResponse.json<ApiSuccessBody<T>>({ ok: true, data, meta });
}

export function fail(error: AppError) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    },
    { status: error.status },
  );
}

export function fromUnknownError(error: unknown) {
  if (error instanceof AppError) {
    return fail(error);
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
    { status: 500 },
  );
}
