export type CrudResourceSchema = {
  resource: string;
  tableName: string;
  idKeys: string[];
  columns: string[];
  requiredOnCreate: string[];
  descripcion: string;
  payloadTemplate: Record<string, unknown>;
};
