# House Upkeep Log

An installable web app for tracking recurring home maintenance: filters, detectors, gutters, water heater and the rest. It shows what's overdue and what's coming up, and keeps a history of every job with its cost and receipts.

**Features**

- Tasks that repeat on an interval (every 3 months) or once a year in a set month (shut off outdoor faucets in October)
- One-tap **Done**, or log a job on any date with a cost, notes and receipt photos or PDFs
- Snooze a task for a week
- **Add to calendar**: exports tasks as repeating calendar events with a 9 am alert
- **History** grouped by year with total spending
- **Home info**: filter sizes, model numbers, contacts and warranty dates (with a warning before they run out)
- Backup and restore, including receipts
- Works offline and installs to your phone's home screen (it's a Progressive Web App)
- No build step and no dependencies: plain HTML, CSS and JavaScript modules

Everything is saved in the browser on your device (tasks in localStorage, receipt files in IndexedDB). Use **Settings → Download backup** now and then, and to move your log to another device.

## Run it locally

```sh
npm start          # serves the folder at http://localhost:8080 (needs Python 3)
npm test           # runs the unit tests (needs Node 20+)
```

Any static file server works in place of `npm start`. Open the page over `http://localhost`, not `file://`, so the offline support can register.

## Install on a phone

Once it's deployed (see below), open the site on your phone:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** menu → Install app

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs the tests and publishes the site on every push to `main`.

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
js/ui.js              Sheets, toasts, small DOM helpers
js/starters.js        Common chores and Home info suggestions
sw.js                 Service worker for offline use
manifest.webmanifest  Install metadata and icons
tests/                Node test runner tests
```

## Data format

Version 2 stores each task's completed jobs in a `log`: `[{ id, date, cost, note, files }]`. "Last done" is the newest job date. Version 1 data (`history` + `lastDone`) is migrated automatically on load and when restoring an old backup.

## Making changes

- **Shipping an update:** bump `VERSION` in `sw.js` whenever you change app files, and add any new file to its `SHELL` list, so installed copies pick up the new version.
- **Adding a common chore:** add a line to `js/starters.js`.
- **Changing what counts as "coming up":** `SOON_DAYS` in `js/schedule.js`.

## Ideas for next steps

- Push notifications (needs a small server)
- Sync across devices with an account (for example Supabase or Firebase)
- Multiple homes
- Export spending to a spreadsheet
