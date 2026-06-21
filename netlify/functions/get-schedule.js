// =====================================================================
// QAisle — get-schedule.js
// A Netlify Function that reads a Google Sheet (Matt's production
// schedule) using a service account, and returns it as clean JSON
// that the pull board can use directly.
//
// This file runs on Netlify's servers, NOT in the browser. The secret
// key never gets sent to anyone visiting the site.
// =====================================================================

const { google } = require('googleapis');

// The exact column layout from Matt's real sheet / our test sheet:
// A = Date, B = Micro Cleared, C = In NetSuite, D = Item, E = Lot Code,
// F = Finished Cases, G = Batches, H = Day, I = Yield, J = Tray Pallets,
// K = Unlabeled, L = ES, M = Sysco, N = Cafe, O = Room, P = Tray Receiving,
// Q = Production Issues, R = Rework Used or Leftover
//
// QAisle only needs: A (Date), D (Item), G (Batches), H (Day), O (Room)

exports.handler = async function (event) {
  try {
    // ---- 1. Read secrets from Netlify environment variables ----
    // These get set once in the Netlify dashboard, never in this file.
    const SHEET_ID = process.env.QAISLE_SHEET_ID;
    const SERVICE_ACCOUNT_EMAIL = process.env.QAISLE_SERVICE_ACCOUNT_EMAIL;
    const PRIVATE_KEY = (process.env.QAISLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Missing configuration.',
          detail:
            'One or more of QAISLE_SHEET_ID, QAISLE_SERVICE_ACCOUNT_EMAIL, QAISLE_PRIVATE_KEY is not set in Netlify environment variables.',
        }),
      };
    }

    // ---- 2. Authenticate as the service account ----
    const auth = new google.auth.JWT(
      SERVICE_ACCOUNT_EMAIL,
      null,
      PRIVATE_KEY,
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );

    const sheets = google.sheets({ version: 'v4', auth });

    // ---- 3. Pull the raw rows from the sheet ----
    // Adjust the tab name below ("Production Schedule") if Matt's tab
    // is named differently. Range A:R covers every column we mirrored.
    const range = "'Production Schedule'!A2:R1000";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });

    const rows = response.data.values || [];

    // ---- 4. Map raw rows into the shape QAisle's pull board expects ----
    const scheduleEntries = rows
      .map((row) => {
        const date = row[0];   // column A
        const item = row[3];   // column D
        const batches = row[6]; // column G
        const day = row[7];    // column H
        const room = row[14];  // column O

        // Skip fully blank rows (no date at all)
        if (!date) return null;

        return {
          date: date.trim(),
          item: item ? item.trim() : null,
          batches: batches ? parseFloat(batches) : null,
          day: day ? day.trim().toLowerCase() : null,
          room: room ? room.trim() : null,
        };
      })
      .filter(Boolean);

    // ---- 5. Return clean JSON to the pull board ----
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Cache for 30 seconds so the pull board isn't hammering the
        // Sheets API on every single page load.
        'Cache-Control': 'public, max-age=30',
      },
      body: JSON.stringify({
        updatedAt: new Date().toISOString(),
        count: scheduleEntries.length,
        entries: scheduleEntries,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to read the Google Sheet.',
        detail: err.message,
      }),
    };
  }
};
