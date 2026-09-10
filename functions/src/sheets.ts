import {google, sheets_v4} from "googleapis";
import {ACTION_ITEM_HEADERS} from "./action-item-row";

export interface SheetsSyncConfig {
  spreadsheetId: string;
  sheetName: string;
  /** Raw JSON string of the Sheets writer service account key. */
  serviceAccountJson: string;
}

function parseServiceAccount(json: string): {
  client_email: string;
  private_key: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("SHEETS_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("SHEETS_SERVICE_ACCOUNT_JSON must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.client_email !== "string" || typeof obj.private_key !== "string") {
    throw new Error("SHEETS_SERVICE_ACCOUNT_JSON missing client_email or private_key");
  }
  return {client_email: obj.client_email, private_key: obj.private_key};
}

export async function getSheetsClient(config: SheetsSyncConfig): Promise<sheets_v4.Sheets> {
  const credentials = parseServiceAccount(config.serviceAccountJson);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.authorize();
  return google.sheets({version: "v4", auth});
}

async function getSheetId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string
): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  const match = meta.data.sheets?.find((s) => s.properties?.title === sheetName);
  const sheetId = match?.properties?.sheetId;
  if (sheetId === null || sheetId === undefined) {
    const titles =
      meta.data.sheets
        ?.map((s) => s.properties?.title)
        .filter(Boolean)
        .join(", ") || "(none)";
    throw new Error(
      `Sheet tab "${sheetName}" not found. Available tabs: ${titles}. Rename a tab to "${sheetName}" or set SHEETS_TAB_NAME.`
    );
  }
  return sheetId;
}

/** Create the target tab if missing (e.g. Sheet still named Sheet1). */
export async function ensureSheetTab(
  sheets: sheets_v4.Sheets,
  config: SheetsSyncConfig
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.spreadsheetId,
    fields: "sheets.properties",
  });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === config.sheetName);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      requests: [{addSheet: {properties: {title: config.sheetName}}}],
    },
  });
}

/** Ensure header row exists (creates/overwrites row 1 if empty or mismatched). */
export async function ensureHeaderRow(
  sheets: sheets_v4.Sheets,
  config: SheetsSyncConfig
): Promise<void> {
  await ensureSheetTab(sheets, config);

  const range = `${config.sheetName}!1:1`;
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range,
  });
  const row = existing.data.values?.[0] ?? [];
  const matches =
    row.length >= ACTION_ITEM_HEADERS.length &&
    ACTION_ITEM_HEADERS.every((h, i) => String(row[i] ?? "").trim() === h);

  if (matches) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: {values: [[...ACTION_ITEM_HEADERS]]},
  });
}

/** Returns 1-based Sheet row number for an action item id, or null. */
export async function findRowById(
  sheets: sheets_v4.Sheets,
  config: SheetsSyncConfig,
  id: string
): Promise<number | null> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A:A`,
  });
  const values = res.data.values ?? [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i]?.[0] ?? "") === id) {
      return i + 1; // 1-based
    }
  }
  return null;
}

export async function upsertActionItemRow(
  sheets: sheets_v4.Sheets,
  config: SheetsSyncConfig,
  row: string[]
): Promise<"updated" | "appended"> {
  await ensureHeaderRow(sheets, config);
  const id = row[0];
  const existingRow = await findRowById(sheets, config, id);

  if (existingRow) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${config.sheetName}!A${existingRow}`,
      valueInputOption: "RAW",
      requestBody: {values: [row]},
    });
    return "updated";
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {values: [row]},
  });
  return "appended";
}

export async function deleteActionItemRow(
  sheets: sheets_v4.Sheets,
  config: SheetsSyncConfig,
  id: string
): Promise<boolean> {
  const rowNumber = await findRowById(sheets, config, id);
  if (!rowNumber) return false;

  const sheetId = await getSheetId(sheets, config.spreadsheetId, config.sheetName);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
  return true;
}

/** Replace all data rows (keeps/rewrites header). */
export async function replaceAllActionItemRows(
  sheets: sheets_v4.Sheets,
  config: SheetsSyncConfig,
  rows: string[][]
): Promise<number> {
  await ensureHeaderRow(sheets, config);

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${config.sheetName}!A:A`,
  });
  const rowCount = existing.data.values?.length ?? 1;

  if (rowCount > 1) {
    const sheetId = await getSheetId(sheets, config.spreadsheetId, config.sheetName);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: 1,
                endIndex: rowCount,
              },
            },
          },
        ],
      },
    });
  }

  if (rows.length === 0) return 0;

  // Sheets API caps ~10MB; batch in chunks of 500
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: `${config.sheetName}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {values: chunk},
    });
  }
  return rows.length;
}
