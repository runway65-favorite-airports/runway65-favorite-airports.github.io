# Runway

Version 0.23.0. Shows Overview, Tasks, Decisions, Housing, a side-by-side Compare view, Requirements, Chronology, Journal and Documents from two Google Sheets. People with edit access can check off tasks and add tasks, decisions and journal entries. People with edit access can also change a home's status and pick the reasons for a rejection.

## Before you upload

1. In Google Cloud (project "Runway"), enable the **Google Drive API** as well. Runway uses it only to ask whether the signed-in person can edit the sheet, which drives the "View only" banner. Without it, everything still works but the banner says Runway could not confirm the role.
2. Confirm the OAuth client's authorized JavaScript origin is exactly `https://runway65-favorite-airports.github.io`.
3. Confirm the API key is restricted to `https://runway65-favorite-airports.github.io/*` and to the Google Picker API only.

## Upload to GitHub (through a pull request, because `main` is protected)

1. In the `runway65-favorite-airports.github.io` repository, choose Add file > Upload files.
2. Upload all the files from this folder: `index.html`, `app.js`, `styles.css`, `config.js`, `privacy.html`, `README.md`, `CHANGELOG.md`.
3. Choose "Create a new branch and start a pull request", then merge it yourself.
4. Wait a minute, then open `https://runway65-favorite-airports.github.io`.

## First run

1. Choose **Continue with Google** and sign in. While the Google app is in Testing, only accounts on the Test users list can sign in.
2. Choose **Choose sheet** and pick your planning sheet. Runway remembers the choice on that device.
3. Check each page: Overview, Housing, Chronology, Documents.

## Test with all three accounts

- The owner: should see "Role: editor".
- An editor on iPhone and iPad (Safari): should see "Role: editor". Each device needs its own sheet choice the first time.
- A viewer: should see the "View only" banner.

## If sign-in or the file chooser does not appear

The page has a Content Security Policy in `index.html` that allows only Google's scripts. If a Google window is blocked, open the browser console (Safari: Develop > Show JavaScript Console), look for a "Refused to load" message, and send it to me. As a last resort for testing only, delete the `Content-Security-Policy` line and reload, then tell me.

## What this version expects in the sheet

Tab names, exactly: `Home Listing`, `Home Tour Notes`, `Contacts Log`, and optionally `Documents & Links`.
Each tab needs a header row and a `Home ID` column. Runway reads columns by header name, so column order does not matter.

## The Runway planning sheet

Tasks, Decisions and the Journal live in a second Google Sheet. The tab names and header names must stay exactly as they are. Create it from `Runway_Planning_Sheet_Template.xlsx`, share it as Restricted (owner, editors, viewers), then choose it in Runway under Sheets.

## Form links (optional, for Forms that are still in use)

Add a tab named `Links` to the planning sheet with the headers `Name`, `URL`, `Group`, `Prefill field`. Put each Google Form link in the URL column and set Group to `Housing forms`. Runway shows them as buttons on the Housing page for people with edit access. The links are never stored in this repository.

For the per-home shortcuts ("Log a tour here", "Log a contact here"), put the field code of the Tour Form's "Which home?" question (for example `entry.1234567890`) in the Prefill field column of each Housing forms row that should have a per-home button. The dropdown options in that Form must read exactly `HOME-### Builder: Model`, the same as Runway builds from the Home Listing tab.

## Trying status changes safely

Before using it on the real home-search sheet, make a copy of that sheet in Drive, choose the copy under Sheets, and change a status there. Change the Sheets choice back to the real sheet afterward.

## Requirements tab (optional)

Add a tab named `Requirements` to the planning sheet with the headers `Section`, `Group`, `Requirement`, `Detail`, `Where it is tracked`, `Priority`. Priority is optional (for example Must or Nice). The Retirement Research workbook has a ready-made Requirements tab you can copy over.

## Home Checks tab (optional)

Add a tab named `Home Checks` to the home-search sheet with the headers `Home ID`, `Req ID`, `Requirement`, `Result`, `Note`, `Checked by`, `Checked on`. Runway saves each home's requirement checks there. The Requirements tab in the planning sheet needs the extra columns `Req ID`, `Tour field` and `Meets when` for the checklist to link requirements to Tour Notes answers.

## Tour Plans tab (optional)

Add a tab named `Tour Plans` to the home-search sheet with the headers `Home ID`, `Planned date`, `Time`, `Note`, `Status`, `Planned by`, `Planned on`. Runway saves planned tours there. Status is Planned, Done or Cancelled.

## Versions

Every upload gets a new version number. Update it in three places: `APP_VERSION` at the top of `app.js`, the `?v=` tags in `index.html`, and `CHANGELOG.md`.

## What it does not do yet

- It can add a home, log a builder contact, log a tour room by room, change a home's status and rejection reasons, and update the matching Tour Notes Decision. Edit other home fields in the sheet or its Forms. If the Home ID column is protected to one person, only that person can add homes.
- It does not upload files or change Drive sharing. Documents are added as links.

## Security notes

- The sign-in token lives in memory only and disappears when the tab closes.
- Only the chosen sheet's id and name are saved in the browser. Neither is secret.
- Sheet text is always inserted as plain text, and links are limited to http and https.
- Never put a client secret, a token, sheet contents or account numbers in this repository.

## Keep the public repository free of personal details

The site and its code are public. They contain no names, employer, family details or sheet contents, and should stay that way. `config.js` holds a target date only.

## Google consent screen links

In Google Auth Platform > Branding, set the home page to `https://runway65-favorite-airports.github.io/` and the privacy policy link to `https://runway65-favorite-airports.github.io/privacy.html`.
