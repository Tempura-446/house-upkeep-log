# House Upkeep Log

An installable web app for tracking recurring home maintenance: filters, detectors, gutters, water heater and the rest. It shows what's overdue and what's coming up, and keeps a history of every job with its cost and receipts.

**Features**

- Tasks that repeat on an interval (every 3 months) or once a year in a set month (shut off outdoor faucets in October)
- One-tap **Done**, or log a job on any date with a cost, notes and receipt photos or PDFs
- Snooze for a day, a week, a month or until a date
- Search tasks, history and Home info
- Several homes (a rental, a cabin, a parent's place), each with its own tasks
- Photos on jobs labeled Receipt, Before or After; manuals and warranty PDFs on Home info items
- Spending chart by year and area, and export of every job to a spreadsheet (CSV)
- A reminder to back up when it's been a while, saving straight to Files, Drive or email where the phone supports it
- **Add to calendar**: exports tasks as repeating calendar events with a 9 am alert
- **History** grouped by year with total spending
- **Home info**: filter sizes, model numbers, contacts and warranty dates (with a warning before they run out)
- Backup and restore, including receipts
- Works offline and installs to your phone's home screen (it's a Progressive Web App)
- No build step and no dependencies: plain HTML, CSS and JavaScript modules

Everything is saved in the browser on your device (tasks in localStorage, receipt files in IndexedDB). Use **Settings → Back up** now and then, and to move your log to another device.

## Run it locally

```sh
npm start          # serves the folder at http://localhost:8080 (needs Python 3)
npm test           # unit tests (needs Node 22+)
npm run test:screens   # screen tests in a headless phone browser (needs @playwright/test)
```

Any static file server works in place of `npm start`. Open the page over `http://localhost`, not `file://`, so the offline support can register.

## Install on a phone

Once it's deployed (see below), open the site on your phone:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** menu → Install app

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs the unit tests and the screen tests (`e2e/`), and publishes the site on every push to `main` only if they pass. A failed run keeps a Playwright trace you can download from the run page.

One-time setup: in the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**. The site URL appears there after the first successful run.

> On a free GitHub account, Pages only works for public repos. With a private repo you need GitHub Pro (or a Team plan), or you can host the folder anywhere that serves static files, such as Netlify or Cloudflare Pages.

## Project layout

```
index.html            App shell
css/styles.css        All styles (light and dark themes)
js/app.js             Screens: Tasks, History, Home info; click wiring
js/task-sheets.js     Task details, log a job (cost + receipts), add/edit task, starter list, calendar export
js/other-sheets.js    Home info form and Settings (calendar, backup, storage, currency)
js/state.js           In-memory data and saving
js/schedule.js        Date math, seasonal schedules, snooze, due status (pure, unit tested)
js/store.js           Data format, migration from v1, backup import/export (pure, unit tested)
js/ics.js             Calendar (.ics) file builder (pure, unit tested)
js/files.js           Receipt storage in IndexedDB, photo shrinking, storage protection
js/ui.js              Sheets, toasts, share/download, small DOM helpers
js/attachments.js     Photo/PDF picker, thumbnails and viewer for jobs and Home info
js/icons.js           Inline line icons
js/cloud.js           Cloud sync and push notifications (optional)
e2e/                  Playwright screen tests
js/starters.js        Common chores and Home info suggestions
sw.js                 Service worker for offline use
manifest.webmanifest  Install metadata and icons
tests/                Node test runner tests
```

## Data format

Version 3 (see the comment at the top of `js/store.js`) adds `homes`, a `homeId` on every task and Home info item, an `updatedAt` stamp on every record and a `deleted` list, so changes can be merged between devices. Each task's completed jobs are in a `log`: `[{ id, date, cost, note, files }]`; "last done" is the newest job date. Older data (v1 `history` + `lastDone`, v2 `settings`) is migrated automatically on load and when restoring an old backup.

## Making changes

- **Shipping an update:** bump `VERSION` in `sw.js` whenever you change app files, and add any new file to its `SHELL` list, so installed copies pick up the new version.
- **Adding a common chore:** add a line to `js/starters.js`.
- **Changing the default "coming up" window:** `SOON_DAYS` in `js/schedule.js` (users can change it in Settings).

## Ideas for next steps

- Cloud sync across devices and push notifications (in progress)
