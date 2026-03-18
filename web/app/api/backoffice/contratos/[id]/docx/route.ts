import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { query } from "@/lib/db";
import { AppError } from "@/lib/api/types";
import { fromUnknownError } from "@/lib/api/response";

type ContractRow = {
  id: string;
  tipo_contrato: string | null;
  nombre_cliente_empresa: string | null;
  nit: string | null;
  nit_indicativo: string | null;
  plan_nombre: string | null;
  precio: string | null;
  fecha_contrato: string | null;
  fecha_primer_pago: string | null;
  adicionales: string | null;
};

function sanitizeFilename(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "contrato";
}

function asText(value: unknown, fallback = ""): string {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

function asUpper(value: unknown, fallback = ""): string {
  return asText(value, fallback).toUpperCase();
}

function formatDateSpanish(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  const day = Number(match[3]);
  const monthNum = Number(match[2]);
  const year = Number(match[1]);
  const months: Record<number, string> = {
    1: "enero",
    2: "febrero",
    3: "marzo",
    4: "abril",
    5: "mayo",
    6: "junio",
    7: "julio",
    8: "agosto",
    9: "septiembre",
    10: "octubre",
    11: "noviembre",
    12: "diciembre",
  };
  return `${day} de ${months[monthNum] ?? ""} de ${year}`.trim();
}

function addMonthsKeepingDay(value: string | null | undefined, monthsToAdd: number): Date | null {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = new Date(year, month - 1 + monthsToAdd, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(day, lastDay));
}

function formatDateSpanishFromDate(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return "";
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${value.getDate()} de ${months[value.getMonth()] ?? ""} de ${value.getFullYear()}`.trim();
}

function normalizePlanName(planName: string): string {
  return String(planName || "").trim().toLowerCase().replace(/^plan\s+/, "");
}

function resolvePlanHoursText(planName: string): string {
  const map: Record<string, string> = {
    lite: "dos",
    esencial: "seis",
    emprende: "siete",
    expande: "ocho",
    elite: "doce",
  };
  return map[normalizePlanName(planName)] ?? "";
}

function resolvePlanHoursNumber(planName: string): string {
  const map: Record<string, string> = {
    lite: "2",
    esencial: "6",
    emprende: "7",
    expande: "8",
    elite: "12",
  };
  return map[normalizePlanName(planName)] ?? "";
}

async function getContract(id: string): Promise<ContractRow> {
  const result = await query<ContractRow>(
    `SELECT
      id::text,
      tipo_contrato,
      nombre_cliente_empresa,
      nit,
      nit_indicativo,
      plan_nombre,
      precio::text,
      fecha_contrato::text,
      fecha_primer_pago::text,
      adicionales
     FROM billing.contratos
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Contrato no encontrado");
  return row;
}

async function resolveTemplatePath(contractType: string): Promise<string> {
  const fileName = contractType === "anual" ? "contrato_anual.docx" : "contrato_mensual.docx";
  const templatePath = path.join(process.cwd(), "templates", fileName);
  try {
    await access(templatePath);
    return templatePath;
  } catch {
    throw new AppError(404, "NOT_FOUND", `No se encontró plantilla DOCX en el proyecto (${fileName})`);
  }
}

function buildTemplateData(contract: ContractRow): Record<string, string> {
  const type = asText(contract.tipo_contrato, "mensual").toLowerCase() === "anual" ? "anual" : "mensual";
  const typeLabel = type === "anual" ? "CONTRATO DE SUSCRIPCION ANUAL" : "CONTRATO MENSUAL";
  const plan = asUpper(contract.plan_nombre);
  const paymentDate = formatDateSpanish(contract.fecha_primer_pago).toUpperCase();
  const planHoursText = resolvePlanHoursText(asText(contract.plan_nombre)).toUpperCase();
  const planHoursNumber = resolvePlanHoursNumber(asText(contract.plan_nombre));

  const data: Record<string, string> = {
    TIPO_CONTRATO: typeLabel,
    NOMBRE_CLIENTE_EMPRESA: asUpper(contract.nombre_cliente_empresa),
    CLIENTE_NOMBRE: asUpper(contract.nombre_cliente_empresa),
    NIT: asUpper(contract.nit),
    CLIENTE_NIT: asUpper(contract.nit),
    INDICATIVO: asUpper(contract.nit_indicativo),
    PLAN: plan,
    PLAN_ADQUIRIDO: plan,
    PLAN_HORAS_TEXTO: planHoursText,
    HORAS_PLAN_TEXTO: planHoursText,
    HORAS_INCLUIDAS_TEXTO: planHoursText,
    PLAN_HORAS_NUMERO: planHoursNumber,
    HORAS_PLAN_NUMERO: planHoursNumber,
    HORAS_INCLUIDAS_NUMERO: planHoursNumber,
    PRECIO: asUpper(contract.precio),
    VALOR_PAGO: asUpper(contract.precio),
    ADICIONALES: asUpper(contract.adicionales),
    MODULOS_ADICIONALES: asUpper(contract.adicionales),
    DOCUMENTOS_ADICIONALES: asUpper(contract.adicionales),
    FECHA_CONTRATO: formatDateSpanish(contract.fecha_contrato).toUpperCase(),
    FECHA_PRIMER_PAGO: paymentDate,
  };

  if (type === "mensual") {
    for (let idx = 0; idx < 12; idx += 1) {
      const n = idx + 1;
      const pDate = formatDateSpanishFromDate(addMonthsKeepingDay(contract.fecha_primer_pago, idx)).toUpperCase();
      data[`PAGO_${n}_NUMERO`] = String(n);
      data[`NUMERO_PAGO_${n}`] = String(n);
      data[`PAGO_${n}_FECHA`] = pDate;
      data[`FECHA_PAGO_${n}`] = pDate;
    }
  }

  return data;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const contract = await getContract(id);
    const contractType = asText(contract.tipo_contrato, "mensual").toLowerCase() === "anual" ? "anual" : "mensual";
    const templatePath = await resolveTemplatePath(contractType);

    const content = await readFile(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
    });
    doc.render(buildTemplateData(contract));
    const buffer = doc.getZip().generate({ type: "nodebuffer" });

    const filename = `${sanitizeFilename(contractType)}_${sanitizeFilename(asText(contract.nombre_cliente_empresa, "cliente"))}_${Date.now()}.docx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fromUnknownError(error);
  }
}
