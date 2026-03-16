import { ApiErrorCode } from "@/lib/types/api";

const MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: "Revisa los datos ingresados. Hay campos invalidos o faltantes.",
  NOT_FOUND: "No encontramos el recurso solicitado.",
  CONFLICT: "La operacion entra en conflicto con el estado actual de los datos.",
  BUSINESS_RULE_VIOLATION: "La accion viola una regla de negocio del modelo de planes.",
  INTERNAL_ERROR: "Se produjo un error interno inesperado.",
  UNAUTHORIZED: "No tienes permiso para ejecutar esta accion.",
};

export function toHumanError(code: ApiErrorCode, fallback?: string): string {
  return fallback ?? MESSAGES[code] ?? "Error no controlado";
}

export function toHumanConsumableError(raw?: string): string | null {
  if (!raw) return null;
  const msg = raw.toLowerCase();
  if (msg.includes("precio_id") && msg.includes("obligatorio") && msg.includes("consumible")) {
    return "Para un consumible debes seleccionar un precio vigente.";
  }
  if (msg.includes("precio no existe")) {
    return "El precio seleccionado no existe. Recarga la pantalla e intenta de nuevo.";
  }
  if (msg.includes("precio no pertenece")) {
    return "El precio elegido no corresponde al producto consumible seleccionado.";
  }
  if (msg.includes("precio") && msg.includes("inactivo")) {
    return "El precio elegido esta inactivo. Selecciona uno vigente.";
  }
  if (msg.includes("no esta vigente")) {
    return "El precio elegido no esta vigente para la fecha de inicio del item consumible.";
  }
  return null;
}
