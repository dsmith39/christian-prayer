# Prayer Keep (MVP)

A simple website for creating prayer lists, adding prayer requests, and receiving daily prayer alerts.

Frontend pages:

- `index.html` landing page
- `login.html` login page
- `register.html` registration page
- `dashboard.html` authenticated prayer dashboard

## Features

- Create multiple prayer lists with descriptions.
- Add prayer requests with notes and priority.
- Turn daily alerts on or off per request.
- Mark requests as answered or active.
- Receive in-app reminders.
- Optionally enable browser notifications.
- Prayer data is saved in MongoDB through the backend API.
- Session token and selected list are cached in `localStorage`.

## Run Locally

1. In project root, install frontend tooling:
	- `npm install`
2. Start a local frontend server:
	- `npm run dev:frontend`
3. Open `http://localhost:5500/index.html`.
4. Choose **Log In** or **Register**.
5. After authentication, you are redirected to `dashboard.html`.
6. Create prayer lists or add prayer requests.
7. Set a daily reminder time for requests that need alerts.
8. Click **Enable Notifications** if you want browser pop-up reminders.

## Backend (MongoDB + Mongoose)

This project now includes a backend in `backend/` for storing user data in MongoDB.

1. Open a terminal in `backend`.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set `MONGODB_URI`.
4. Start the API with `npm run dev`.

API base URL: `http://localhost:5000/api`

Auth + frontend usage:

1. Start the backend in `backend/` with `npm run dev`.
2. Start the frontend in root with `npm run dev:frontend`.
3. Open `http://localhost:5500/index.html` and use landing links to **Log In** or **Register**.
4. After successful auth, use `dashboard.html` to create prayer lists and submit prayer requests.
5. Data is saved to MongoDB automatically through authenticated API calls.

## Notes

- Browser notifications depend on user permission and browser support.
- Keep your backend server running for login, registration, and data sync.

## Good Next Additions

- Share lists with family or small groups.
- SMS/email alerts for reminders.
- Prayer history and answered-prayer timeline.
- Recurring templates (daily, weekly, monthly focus).
