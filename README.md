# still.

A quiet, minimalist clock, timer, and alarm for the web. Built with React and Vite.

## Features

- Live local clock with analog and digital displays, seconds, and 12/24-hour formats
- Countdown timer with start, pause, reset, and an audio chime
- Stopwatch with split laps saved to your account
- Username and password accounts with private short notes
- One-time and daily alarms with labels, enable/disable controls, and an audio chime
- Light and dark themes
- Full-viewport clock and timer focus screens; press **Esc** to return
- Theme and alarms saved in local browser storage; notes and stopwatch laps saved in MongoDB
- Responsive layout for desktop and mobile

Alarms ring while the app is open in a browser. Alarm and theme settings are stored
on the current device and are not synced between browsers.

## Run locally

Requires Node.js 20.19+.

```sh
npm ci
npm --prefix backend install
npm run dev
```

In a second terminal, configure `backend/.env` using `backend/.env.example` and run:

```sh
npm run dev:api
```

The Vite development server proxies `/api` requests to the local backend on port 3001.
Set `MONGODB_URI` and a random `JWT_SECRET` in `backend/.env`; never commit that file.

## Checks and production build

```sh
npm run lint
npm run build
npm run test:api
npm run preview
```

The production files are written to `dist/`.

## Deploy to GitHub Pages

The included GitHub Actions workflow builds and deploys the site when code is
pushed to `main` or `master`.

1. Push this project to a GitHub repository.
2. In the repository, open **Settings → Pages** and set the source to **GitHub Actions**.
3. Push to `main` or `master`, or start the **Deploy to GitHub Pages** workflow manually.

This project uses the custom domain `https://stopwatch.alfar.ca/` and root-relative
asset URLs. The GitHub Pages build includes `public/CNAME` for that domain.

## Deploy the account API

The frontend is static, so deploy the API as a separate Render web service:

1. Create a Render web service for this repository and set its **Root Directory** to `backend`.
2. Use `npm ci` as the build command and `npm start` as the start command.
3. Configure these Render environment variables:
   - `MONGODB_URI`: your MongoDB connection string
   - `JWT_SECRET`: a private random value of at least 32 bytes
   - `CLIENT_ORIGINS`: `https://stopwatch.alfar.ca`
4. Configure MongoDB network access for the Render service and keep database credentials private.
5. In GitHub, add the Actions repository variable `VITE_API_URL` with the public Render service URL (for example, `https://your-service.onrender.com`, without `/api`).
6. Run the **Deploy to GitHub Pages** workflow again so the frontend is built with that API URL.

For local development, `CLIENT_ORIGINS` should also include `http://localhost:5173`.
