# still.

A quiet, minimalist clock, timer, and alarm for the web. Built with React and Vite.

## Features

- Live local clock with analog and digital displays, seconds, and 12/24-hour formats
- Countdown timer with start, pause, reset, and an audio chime
- One-time and daily alarms with labels, enable/disable controls, and an audio chime
- Light and dark themes
- Full-viewport clock and timer focus screens; press **Esc** to return
- Theme and alarms saved in local browser storage
- Responsive layout for desktop and mobile

Alarms ring while the app is open in a browser. Alarm and theme settings are stored
on the current device and are not synced between browsers.

## Run locally

Requires Node.js 20.19+.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Checks and production build

```sh
npm run lint
npm run build
npm run preview
```

The production files are written to `dist/`.

## Deploy to GitHub Pages

The included GitHub Actions workflow builds and deploys the site when code is
pushed to `main` or `master`.

1. Push this project to a GitHub repository.
2. In the repository, open **Settings → Pages** and set the source to **GitHub Actions**.
3. Push to `main` or `master`, or start the **Deploy to GitHub Pages** workflow manually.

For a project repository, the site URL is
`https://<owner>.github.io/<repository>/`. The Vite base path is set from the
GitHub Actions repository name during deployment.
