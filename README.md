# House Upkeep Log

An installable web app for tracking recurring home maintenance: filters, detectors, gutters, water heater and the rest. It shows what's overdue, what's coming up in the next two weeks, and keeps a history of when you did each job.

- Works offline and installs to your phone's home screen (it's a Progressive Web App).
- No build step and no dependencies: plain HTML, CSS and JavaScript modules.
- Tasks are saved in the browser on your device. Use **Backup** to download a copy or move your log to another device.

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
js/app.js             UI: rendering, forms, backup
js/schedule.js        Date math and due-status logic (pure, unit tested)
js/store.js           Saving to the device, backup import/export
js/starters.js        The list of common chores offered to new users
sw.js                 Service worker for offline use
manifest.webmanifest  Install metadata and icons
tests/                Node test runner tests
```

## Making changes

- **Shipping an update:** bump `VERSION` in `sw.js` whenever you change app files, so installed copies pick up the new version.
- **Adding a common chore:** add a line to `js/starters.js`.
- **Changing what counts as "coming up":** `SOON_DAYS` in `js/schedule.js`.

## Ideas for next steps

- Reminders (push notifications or a calendar feed)
- Sync across devices with an account (for example Supabase or Firebase)
- Seasonal tasks tied to a month instead of an interval
- Costs, receipts and photos per job
- Multiple homes or rooms
