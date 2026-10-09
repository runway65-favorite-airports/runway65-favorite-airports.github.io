# Runway

Read-only first version. Shows Overview, Housing, Chronology and Documents from one Google Sheet.

## Before you upload

1. In Google Cloud (project "Runway"), enable the **Google Drive API** as well. Runway uses it only to ask whether the signed-in person can edit the sheet, which drives the "View only" banner. Without it, everything still works but the banner says Runway could not confirm the role.
2. Confirm the OAuth client's authorized JavaScript origin is exactly `https://runway65-favorite-airports.github.io`.
3. Confirm the API key is restricted to `https://runway65-favorite-airports.github.io/*` and to the Google Picker API only.

## Upload to GitHub (through a pull request, because `main` is protected)

1. In the `runway65-favorite-airports.github.io` repository, choose Add file > Upload files.
2. Upload all five files from this folder: `index.html`, `app.js`, `styles.css`, `config.js`, `README.md`.
3. Choose "Create a new branch and start a pull request", then merge it yourself.
4. Wait a minute, then open `https://runway65-favorite-airports.github.io`.

## First run

1. Choose **Continue with Google** and sign in. While the Google app is in Testing, only accounts on the Test users list can sign in.
2. Choose **Choose sheet** and pick *Retirement Home Listings*. Runway remembers the choice on that device.
3. Check each page: Overview, Housing, Chronology, Documents.

## Test with all three accounts

- Steve: should see "Role: editor".
- Kam (iPhone and iPad, in Safari): should see "Role: editor". Each device needs its own sheet choice the first time.
- Daniel: should see the "View only" banner.

## If sign-in or the file chooser does not appear

The page has a Content Security Policy in `index.html` that allows only Google's scripts. If a Google window is blocked, open the browser console (Safari: Develop > Show JavaScript Console), look for a "Refused to load" message, and send it to me. As a last resort for testing only, delete the `Content-Security-Policy` line and reload, then tell me.

## What this version expects in the sheet

Tab names, exactly: `Home Listing`, `Home Tour Notes`, `Contacts Log`, and optionally `Documents & Links`.
Each tab needs a header row and a `Home ID` column. Runway reads columns by header name, so column order does not matter.

## What it does not do yet

- It cannot change anything. Add and edit happen in the sheet or its Forms.
- Tasks and Decisions need a separate "Runway" sheet, which comes next.

## Security notes

- The sign-in token lives in memory only and disappears when the tab closes.
- Only the chosen sheet's id and name are saved in the browser. Neither is secret.
- Sheet text is always inserted as plain text, and links are limited to http and https.
- Never put a client secret, a token, sheet contents or account numbers in this repository.
