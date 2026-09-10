import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import * as functions from "firebase-functions/v1";
import {defineSecret, defineString} from "firebase-functions/params";
import {logger} from "firebase-functions";
import {actionItemToRow, ActionItemDoc} from "./action-item-row";
import {
  deleteActionItemRow,
  getSheetsClient,
  replaceAllActionItemRows,
  upsertActionItemRow,
  SheetsSyncConfig,
} from "./sheets";

/**
 * 1st gen Functions (same generation as existing acceptInvite).
 * Avoids 2nd gen Eventarc / Cloud Run invoker IAM that requires Owner.
 *
 * Names differ from the failed 2nd gen deploy so we don't collide with
 * any half-created Cloud Run services.
 */

initializeApp();

export {
  onActionItemEmailAutomations,
  onUserEmailAutomations,
  sweepOverdueActionItemEmails,
  sendTestAlertEmail,
  requestPasswordResetEmail,
} from "./email/triggers";

const sheetsSpreadsheetId = defineString("SHEETS_SPREADSHEET_ID", {
  default: "",
  description: "Google Sheet ID from the spreadsheet URL",
});

const sheetsTabName = defineString("SHEETS_TAB_NAME", {
  default: "ActionItems",
  description: "Tab/sheet name that holds action item rows",
});

const sheetsServiceAccountJson = defineSecret("SHEETS_SERVICE_ACCOUNT_JSON");

function syncConfig(): SheetsSyncConfig {
  const spreadsheetId = sheetsSpreadsheetId.value()?.trim();
  const serviceAccountJson = sheetsServiceAccountJson.value()?.trim();
  if (!spreadsheetId) {
    throw new Error("SHEETS_SPREADSHEET_ID is not set");
  }
  if (!serviceAccountJson) {
    throw new Error("SHEETS_SERVICE_ACCOUNT_JSON secret is not set");
  }
  return {
    spreadsheetId,
    sheetName: sheetsTabName.value() || "ActionItems",
    serviceAccountJson,
  };
}

const regional = functions.region("us-central1");

/** Live sync: create/update/delete on actionItems/{id} → Google Sheets. */
export const mirrorActionItemToSheet = regional
  .runWith({
    secrets: [sheetsServiceAccountJson],
    timeoutSeconds: 120,
    memory: "256MB",
  })
  .firestore.document("actionItems/{id}")
  .onWrite(async (change, context) => {
    const id = context.params.id as string;
    const config = syncConfig();
    const sheets = await getSheetsClient(config);

    if (!change.after.exists) {
      const removed = await deleteActionItemRow(sheets, config, id);
      logger.info("actionItems delete mirrored to Sheets", {id, removed});
      return;
    }

    const data = change.after.data() as ActionItemDoc;
    const row = actionItemToRow(id, data);
    const result = await upsertActionItemRow(sheets, config, row);
    logger.info("actionItems upsert mirrored to Sheets", {id, result});
  });

/** Admin-only full Sheet rebuild from Firestore. */
export const backfillActionItemsSheet = regional
  .runWith({
    secrets: [sheetsServiceAccountJson],
    timeoutSeconds: 300,
    memory: "512MB",
  })
  .https.onCall(async (_data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError("unauthenticated", "Sign in required");
    }

    const db = getFirestore();
    const userSnap = await db.doc(`users/${context.auth.uid}`).get();
    const role = userSnap.data()?.role;
    if (role !== "Admin") {
      throw new functions.https.HttpsError("permission-denied", "Admin role required");
    }

    try {
      const config = syncConfig();
      const sheets = await getSheetsClient(config);
      const snap = await db.collection("actionItems").get();
      const rows = snap.docs.map((doc) =>
        actionItemToRow(doc.id, doc.data() as ActionItemDoc)
      );
      const written = await replaceAllActionItemRows(sheets, config, rows);
      logger.info("actionItems backfill complete", {written});
      return {written, spreadsheetId: config.spreadsheetId, sheetName: config.sheetName};
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("actionItems backfill failed", {message, err});
      throw new functions.https.HttpsError(
        "failed-precondition",
        message.slice(0, 400) || "Sheets backfill failed"
      );
    }
  });
