# Changelog

## 0.22.0
- The status filter chips on the Housing page now show how many homes are in each status, for example All (15), Active (6), Rejected (7), the same counts as the Overview.
- Each home's card shows the date it was added, taken from the Timestamp column of the Home Listing tab (for example "Added 10/24/2026"). A home with no timestamp shows nothing.

## 0.21.0
- Removed the "Open in Google Sheets" buttons from the Sheets page and the "Open the sheet" button from the Housing page. Runway no longer links to the underlying sheets.

## 0.20.1
- Reverted the sheet choosing to how it worked in 0.19.0 (and 0.16.1): the first screen asks for the home-search sheet, the planning sheet is chosen from the Overview or the Sheets page, and choosing the wrong file shows "That does not look like the right sheet" with a Choose sheet button.
- The 0.20.0 two-slot "Connect your sheets" screen and automatic filing by tab names are removed. Everything else is unchanged from 0.19.0.

## 0.20.0
- Clearer, forgiving sheet choosing. The first screen now reads "Connect your sheets" and shows both slots, the home-search sheet and the planning sheet, each marked Connected or Not connected yet, with the tabs to look for.
- One Choose a sheet button works for both. After you pick a file, Runway reads its tab names and puts it in the right slot, so you can choose the two files in either order, and choosing the wrong one first (for example the planning sheet where the home-search sheet was expected) is simply accepted and filed correctly.
- A file with neither set of tabs is refused straight away, with the tabs it does have, instead of failing later with a tab error.
- The Sheets page shows the tabs each slot expects, and the confirmation message says which slot a file went into and what is left to choose.

## 0.19.0
- Cleanup for retiring the Google Forms. The "Add or update" card on the Housing page and the per-home form buttons appear only while Form links are in the Links tab, so removing the links removes the buttons. The hint about adding Form links is gone.
- After adding a home, the reminder to add it to the Forms' "Which home?" dropdown appears only while Form links are still in the Links tab.
- Footer and Requirements wording no longer refer to the Forms.

## 0.18.0
- New: Log a tour is now a full-screen page, reached from a button on each home's card. It is organized room by room: Outside and lot, Living areas, Kitchen, Laundry, mud room and garage, Primary suite, Primary bath, Utilities, package and HOA, Builder, and Overall. Tap the room you are in; each room chip shows how many answers you have given there. Previous and Next buttons walk you through.
- Every Tour Notes question is covered (all the columns the Tour Form fills): Yes or No taps, pick-one chips, tick boxes for appliances, type-or-tap suggestions built from your past answers, notes and numbers. A question only appears if its column exists in the sheet.
- Your answers are saved on the device as you go, so a lost signal or a locked screen does not lose a tour. They are cleared when you save, discard, or sign out. A card shows "Continue your tour draft" while one is waiting.
- Runway writes one Tour Notes row in the Form's own columns, leaves the blank gap and Home ID formula columns alone, and keeps the earlier safeguards (visit date required, one tour per home per day, plain-text escaping, optional status sync with rejection reasons).
- The privacy policy now describes the saved draft.
- Fixed: this replaces the smaller in-card form from 0.17.0.

## 0.17.0
- New: each home's card has a Log a tour form for people with edit access (stage 1 of replacing the Tour Notes Form). It asks for the visit date, a one-tap Yes or No on up to 19 features you check on a visit (only those with a matching column in the Tour Notes tab), an overall impression, pros, cons, HOA, a Decision and optional decision notes.
- Runway writes one row to the Home Tour Notes tab in the Form's own columns: home identification, community, address, "Which home?", who logged it and when. The blank gap column and the Home ID formula column are left alone, so the Home ID fills in by itself.
- The home's requirements checklist and the Compare page use the new answers straight away.
- Optional (on by default): also set the home's status in Home Listing to the Decision. Choosing Rejected asks for at least one reason.
- Safeguards: a visit date is required, a second tour of the same home on the same date is refused, and typed text is saved as plain text.
- Not in stage 1: the remaining Form fields (lot, package and kitchen details, appliances list, builder vetting). Keep using the Form for those until stage 2.

## 0.16.1
- Fixed: choosing the wrong file as the home-search sheet or the planning sheet (a file without the tabs Runway needs) left the person stuck, with no way to choose again. The error now says "That does not look like the right sheet" and offers a Choose sheet button (Choose planning sheet for the planning sheet).
- Fixed: the Sheets page now opens even when a sheet failed to load, and shows the name of the file that was chosen, so a wrong choice can always be changed.

## 0.16.0
- New: Compare homes page. Pick up to six homes (Active homes are chosen to start) and see them side by side: status, community, list price, price with upgrades, price per square foot, size, bedrooms and baths, garage, HOA, when toured, the tour decision, latest contact, open follow-up, pros, cons and the listing link.
- New: when the planning sheet's Requirements tab is connected, the comparison includes a Requirements section with each home's met, not met and unknown counts and a Yes, No or ? for every requirement. A switch shows only the requirements where the chosen homes differ.
- Read-only for everyone. Reached from a "Compare homes side by side" button on the Housing page and a "Compare these homes" button on the Overview.
- On narrow screens the table scrolls sideways and its row labels stay in place.

## 0.15.0
- New: each home's card has a "Log a contact" form for people with edit access. It records who you spoke with (filled from the home's contact), the date, how (in person, email, phone, text, online form), direction (inbound, outbound, meeting), subject, summary, an optional https link, and whether action is required, with the next action and due date. Runway writes the same row your Contact Form writes, with "Which Home?" set from the home, so the Home ID fills in by itself.
- Runway writes only the Contact Form's own columns. The blank gap column and the Home ID formula column are left alone.
- New contacts appear on the home's card and, when action is required, under Open follow-ups on the Overview.
- Fixed: the notice shown after adding a home now sits in a fixed bar at the bottom of the screen, so it is visible wherever you are on the page.

## 0.14.0
- New: editors can add a home from the Housing page. Runway gives it the next Home ID, adds it to the Home Listing tab with status Researching (or the status you choose), and records who added it. It fills Style and Garage with the most common values already in the sheet. Duplicate homes (same builder, model and community, or the same listing link) are refused.
- New: after adding a home, a notice reminds you to add the new "HOME-### Builder: Model" option to the "Which home?" dropdown in the Tour and Contact Forms, which the pre-filled buttons need.
- Fixed: a message such as "Give the task a title" no longer redraws the page and clears what you typed. Typed text in every add form (task, decision, journal, document, home) survives a redraw, and each form stays open.
- Changed: messages now appear without redrawing the page.

## 0.13.0
- New: each home's card has a Requirements checklist. Every requirement shows Yes, No or Unknown. Answers come from the home's latest Tour Notes entry when the requirement is linked to a Yes/No Tour Notes column, and from checks that people with edit access record in Runway. A check made in Runway overrides the Tour Notes answer, and tapping the same button again clears it.
- New: the card shows a count, for example "21 of 38 requirements met, 2 not met". It is highlighted when a requirement marked Must is not met.
- New: Requirements tab gets three optional columns: Req ID (permanent ID), Tour field (the Tour Notes column that answers it) and Meets when (Yes, or No for requirements like "center island without a main sink").
- New: checks are saved in a Home Checks tab in the home-search sheet (Home ID, Req ID, Requirement, Result, Note, Checked by, Checked on). Until that tab exists, checklists are read-only and editors see how to add it.
- Viewers see the same checklist with no buttons.

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
