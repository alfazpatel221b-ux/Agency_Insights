/** Column order must match the Sheet header row. */
export const ACTION_ITEM_HEADERS = [
  "id",
  "taskName",
  "description",
  "assignedTo",
  "section",
  "clientName",
  "status",
  "priority",
  "dueDate",
  "comment",
  "createdAt",
  "updatedAt",
] as const;

export type ActionItemSheetField = (typeof ACTION_ITEM_HEADERS)[number];

export interface ActionItemDoc {
  id?: string;
  taskName?: string;
  description?: string;
  assignedTo?: string;
  section?: string;
  clientId?: string;
  clientName?: string;
  comment?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

/** Flatten a Firestore action item into one Sheet row (12 columns). */
export function actionItemToRow(id: string, data: ActionItemDoc): string[] {
  return [
    id,
    cell(data.taskName),
    cell(data.description),
    cell(data.assignedTo),
    cell(data.section),
    cell(data.clientName),
    cell(data.status),
    cell(data.priority),
    cell(data.dueDate),
    cell(data.comment),
    cell(data.createdAt),
    cell(data.updatedAt),
  ];
}
