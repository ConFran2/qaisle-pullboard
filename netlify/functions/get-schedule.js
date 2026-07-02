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

// Column layout (0-indexed from A):
// A=Date, B=Micro Cleared, C=In NetSuite, D=Item, E=Lot Code,
// F=Finished Cases, G=Batches, H=Day, I=Yield, J=Tray Pallets,
// K=Unlabeled, L=ES, M=Sysco, N=Cafe, O=Room,
// P=Partial Item 1, Q=Weight 1, R=Partial Item 2, S=Weight 2,
// T=Partial Item 3, U=Weight 3, V=Partial Item 4, W=Weight 4,
// X=Tray Receiving, Y=Production Issues, Z=Rework Used or Leftover
//
// QAisle reads: A (Date), D (Item), G (Batches), H (Day), O (Room),
// plus the 4 Partial Item / Weight pairs (P-W).

exports.handler = async function (event) {
  try {
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

    const auth = new google.auth.JWT(
      SERVICE_ACCOUNT_EMAIL,
      null,
      PRIVATE_KEY,
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );

    const sheets = google.sheets({ version: 'v4', auth });

    // Range extended through column W to capture all 4 override pairs.
    const range = "'Production Schedule'!A2:W1000";

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });

    const rows = response.data.values || [];

    const scheduleEntries = rows
      .map((row) => {
        const date = row[0];    // A
        const item = row[3];    // D
        const batches = row[6]; // G
        const day = row[7];     // H
        const room = row[14];   // O

        if (!date) return null;

        // Build the 4 partial/override pairs. Columns:
        // P(15)/Q(16), R(17)/S(18), T(19)/U(20), V(21)/W(22)
        const partialPairs = [
          { item: row[15], weight: row[16] },
          { item: row[17], weight: row[18] },
          { item: row[19], weight: row[20] },
          { item: row[21], weight: row[22] },
        ];

        // Only keep pairs where the component name is actually filled in.
        const overrides = partialPairs
          .filter((p) => p.item && String(p.item).trim() !== '')
          .map((p) => ({
            component: String(p.item).trim(),
            // Keep the raw weight as-is (string or empty) so the
            // front end can distinguish "blank" from "0" reliably.
            weight: p.weight === undefined || p.weight === null || String(p.weight).trim() === ''
              ? null
              : parseFloat(p.weight),
            weightRaw: p.weight === undefined ? '' : String(p.weight),
          }));

        return {
          date: date.trim(),
          item: item ? item.trim() : null,
          batches: batches ? parseFloat(batches) : null,
          day: day ? day.trim().toLowerCase() : null,
          // Normalize to a canonical "room N" string by extracting just
          // the digit, so any typed variation (room1, Room 1, ROOM  1,
          // room1 with no space) all match identically downstream. This
          // matters because the front end does an exact string match.
          room: (function(){
            if(!room) return null;
            var m = String(room).match(/(\d+)/);
            return m ? 'room ' + m[1] : null;
          })(),
          overrides: overrides, // [] when it's a plain full run
        };
      })
      .filter(Boolean);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
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
