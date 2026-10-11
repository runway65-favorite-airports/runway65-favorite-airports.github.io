# Changelog

## 0.12.0
- New: Requirements page, read from an optional Requirements tab in the Runway planning sheet (headers: Section, Group, Requirement, Detail, Where it is tracked, Priority). Requirements are grouped by section, with a tag for where each is checked (Tour Notes, Home Listings, Pre-qualify, Not captured) and a Must or Nice tag when a Priority is filled in.
- New: filter by where a requirement is tracked, and search by text.
- Read-only for everyone. Until the tab exists, the page explains how to add it.

## 0.11.0
- New: when you change a home's status, a checkbox (on by default) also sets the Decision in that home's latest Tour Notes entry to match. Runway checks both rows still belong to the Home ID, then writes the Home Listing and Tour Notes cells in one save.
- New: when the Tour Notes Decision and the Home Listing status disagree, the home's card says so.
- The latest tour is the one with the most recent Visit Date. Homes with no Tour Notes entry get no checkbox.
- Changed: a home's card now shows the Decision from its latest tour, not its first.

## 0.10.0
- New: people with edit access can add a document link from the Documents page. Runway appends a row to the Documents & Links tab with title, link, workstream, optional home, owner, sensitivity and review date, and fills in "Added by", "Added on" and the Drive file ID (when the link is a Drive or Docs link).
- Safeguards: the link must start with https://, a link already in the list is refused, and typed text is saved as plain text.
- Runway only adds the link. It does not change who can open the file in Drive.

## 0.9.0
- New: choosing Rejected for a home on the Housing page opens a checklist of reasons, the same nine as the Rejected Reason question in the Home Listing Form. At least one is required. Runway writes the status and the reasons together, comma-separated, in one save.
- New: changing a rejected home to another status clears its reason, and the card says so.
- New: you can change a rejected home's reasons without changing its status.
- Includes everything from 0.8.1 (security fixes, privacy page wording).

## 0.8.1
- Security: text typed in the app is saved to the sheets as plain text. A task title, note or journal entry that starts with =, +, - or @ could previously have been read by Google Sheets as a formula. The app now adds a leading apostrophe so it stays text.
- Security: Runway refuses to run inside a frame on another website, which blocks clickjacking.
- Fixed: the "You are here" marker now appears in the Chronology even after the target date has passed.
- Privacy policy: states that the pages load fonts from Google Fonts, which means Google sees the visitor's IP address.

## 0.8.0
- New: people with edit access can change a home's status from its card on the Housing page. Runway writes the new status to that home's row in the Home Listing tab, after confirming the row still belongs to that Home ID.
- Changed: a home's card stays open and the page keeps its place after saving.
- Only the six standard statuses can be chosen: Researching, To tour, Toured, Active, Rejected, Purchased.

## 0.7.0
- New: each home also gets a "Log a contact here" button when the Links tab has a row named for the contact Form with its Prefill field filled in. Any Housing forms row with a Prefill field gets a per-home button.
- Changed: the per-home buttons no longer require the row name to contain "tour".

## 0.6.0
- New: each home on the Housing page has a "Log a tour here" button for people with edit access. It opens your Tour Notes Form with that home already chosen in the "Which home?" question.
- Setup: the Links tab gets a fourth column, Prefill field, holding the Form question's field code (it looks like entry.1234567890) on the "Log a tour" row.

## 0.5.0
- New: the Housing page has an "Add or update" card for people with edit access, with buttons that open your Google Forms (add a listing, log a tour, log a contact) and the sheet itself.
- The form links are read from an optional Links tab in the Runway planning sheet, not from this public site, so they stay private. Only Google Forms links are used.

## 0.4.0
- New: Journal page. People with edit access can add dated entries, and everyone can read them. Entries also appear in the Chronology and as "Latest journal entry" on the Overview.
- New: the Runway planning sheet needs a tab named Journal with the headers Entry ID, Date, Title, Detail, Logged by. Until it exists, the Journal page explains what to add and everything else keeps working.
- Changed: "Homes to tour" is now its own card on the Overview.

## 0.3.0
- New: Tasks and Decisions pages, read from a separate Runway planning sheet.
- New: people with edit access can check off tasks, add tasks, add decisions, and record decisions. People with view access can read everything and change nothing.
- New: Overview shows task progress, the next five open tasks, and open decisions.
- New: Chronology includes finished tasks and recorded decisions.
- New: Sheets page to choose or change each connected sheet.
- New: version number in the footer and on the Sheets page, and version tags on the page's file links so a new version loads without a forced refresh.
- Changed: status names such as "To tour" match regardless of capitalization.
- Changed: the privacy policy now says that people with edit access can have Runway change the planning sheet when they take an action.

## 0.2.0
- Removed personal details from the public files.
- Added the privacy policy page and links.

## 0.1.0
- First read-only version: Overview, Housing, Chronology, Documents.
