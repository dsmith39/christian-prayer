# Prayer Keep Backend

Express + MongoDB backend using Mongoose to store user prayer data.

## Setup

1. Open a terminal in `backend`.
2. Install dependencies:
   - `npm install`
3. Create a `.env` file from `.env.example`.
4. Start MongoDB locally (or provide a MongoDB Atlas URI in `MONGODB_URI`).
5. Run the API:
   - `npm run dev`

## Environment Variables

- `PORT` (default: `5000`)
- `MONGODB_URI` (required)
- `CLIENT_ORIGIN` (optional comma-separated CORS origins)
- `JWT_SECRET` (required, used for login tokens)

## Data Model

A `User` document stores:

- `name`
- `email` (unique)
- `passwordHash`
- `prayerLists[]`
- each prayer list has `name`, `description`, and `prayers[]`
- each prayer request has `title`, `notes`, `priority`, `answered`, `alertEnabled`, `alertTime`
- each account always has an auto-created `Uncategorized` system list that cannot be deleted

## API Endpoints

- `GET /api/health`
- `POST /api/auth/register` register and return JWT
- `POST /api/auth/login` login and return JWT
- `GET /api/auth/me` get current user (requires Bearer token)
- `GET /api/users/me` get current user prayer data (requires Bearer token)
- `POST /api/users/lists` create prayer list (requires Bearer token)
- `POST /api/users/prayers` create prayer request directly in `Uncategorized` (requires Bearer token)
- `POST /api/users/lists/:listId/prayers` create prayer request (requires Bearer token)
- `PATCH /api/users/lists/:listId/prayers/:prayerId` update answered state (requires Bearer token)
- `DELETE /api/users/lists/:listId/prayers/:prayerId` delete prayer request (requires Bearer token)
