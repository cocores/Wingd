# Wingd 🛩️

A dating app built around trust: every **pilot** (the person dating) brings
**co-pilots** — friends who vouch for them. When two pilots match, it's their
co-pilots who chat first, in a private room, to vet whether the match is a
good fit. Only once co-pilots on both sides give the green light do the
pilots themselves start chatting.

## How it works

1. **Sign up & build your pilot profile** — with email/password, or one tap
   via Google or Apple — then add your age, bio, a photo you upload directly,
   and a location you can either type (with city suggestions after 3
   characters) or detect automatically from your browser.
2. **Invite co-pilots** — generate a shareable invite link; a friend who
   accepts it becomes your co-pilot.
3. **Discover & swipe** — browse other pilots (optionally filtered by age
   range or gender), like or pass.
4. **Match** — when two pilots like each other, a match is created in
   `copilot_review` status. Pilots themselves can't message yet.
5. **Co-pilot vetting room** — any co-pilot of either pilot can join a
   private chat with the other pilot's co-pilots to compare notes. Each
   side's co-pilots can vouch (✔) or call it off (✕).
6. **Pilot chat unlocks** — once both sides' co-pilots vouch, the match
   flips to `approved` and the two pilots get their own private chat.
7. **Anyone can walk away** — a co-pilot can withdraw a vouch at any time
   (dropping an already-approved match back to co-pilot review), and either
   pilot can unmatch outright, which ends the match for good.

Nav badges keep everyone in the loop: new matches, unread co-pilot/pilot
messages, and new co-pilot invite acceptances all show up as counts next to
**Matches** and **Co-pilots**.

## Stack

- **Backend**: Node.js, Express, better-sqlite3, Socket.io (real-time chat),
  JWT auth, bcrypt password hashing, Google/Apple social sign-in verified
  server-side, Multer (photo uploads), a small proxy to OpenStreetMap's
  Nominatim for location search/detection (no API key needed).
- **Frontend**: React + Vite, React Router, socket.io-client, axios.

## Running locally

### 1. Backend

```bash
cd server
cp .env.example .env
npm install
npm run dev   # http://localhost:4000
```

The SQLite database file (`server/wingd.db`) is created automatically on
first run.

### 2. Frontend

```bash
cd client
npm install
npm run dev   # http://localhost:5173
```

The Vite dev server proxies `/api`, `/uploads`, and `/socket.io` to the
backend, so just open http://localhost:5173.

Uploaded profile photos are stored on disk under `server/uploads/` and
served statically from `/uploads/...`.

### 3. Social login (optional)

Email/password works with no setup. To turn on the "Continue with Google" /
"Continue with Apple" buttons, set matching client IDs on both sides — leaving
either pair blank keeps that provider's button hidden and its `/auth/*`
endpoint disabled.

**Google:**
1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an OAuth 2.0 Client ID of type "Web application".
2. Add `http://localhost:5173` as an authorized JavaScript origin.
3. Set the same client ID as both `GOOGLE_CLIENT_ID` in `server/.env` and
   `VITE_GOOGLE_CLIENT_ID` in `client/.env`.

**Apple:**
1. In the [Apple Developer portal](https://developer.apple.com/account/resources/identifiers/list/serviceId),
   create a Services ID (this is the identifier used as the client ID for
   web Sign in with Apple) and enable "Sign in with Apple" on it.
2. Register `http://localhost:5173` as a website domain/return URL for that
   Services ID (Apple requires HTTPS for real domains, but `localhost` is
   allowed for local testing).
3. Set the Services ID identifier as both `APPLE_CLIENT_ID` in
   `server/.env` and `VITE_APPLE_CLIENT_ID` in `client/.env`.

Both providers hand the frontend an ID token (a signed JWT), which the
backend verifies independently — Google's via `google-auth-library`, Apple's
against Apple's published JWKS — before creating or linking a user. Sign-in
never trusts the frontend's claim of who the user is, only the verified
token. A social sign-in links onto an existing account with the same email;
if the email is new, a fresh account is created with no password (so that
user always signs in with the same provider afterwards, or sets a password
later if this app grows a "set password" flow).

## Deploying

The frontend (a static Vite build) and backend (a stateful Express process
with Socket.io and a SQLite file on disk) need to be deployed separately —
there's no single serverless platform that fits both.

### Frontend on Vercel

`vercel.json` at the repo root already tells Vercel how to build `client/`
and serves `index.html` for every route (so React Router's client-side
routes don't 404 on refresh) — importing this repo with the project's Root
Directory left at the repo root just works. Set these two things in the
Vercel project's environment variables:

- `VITE_API_URL` — the backend's full origin (see below), no trailing slash.
- Any social login vars from `client/.env.example` you want enabled.

Without `VITE_API_URL` set, the deployed frontend has nowhere to send API
calls and nothing will load past the login screen.

### Backend: needs a host that runs a persistent process

Vercel's serverless functions can't hold the WebSocket connections Socket.io
needs, and their filesystem doesn't persist writes to `wingd.db` between
requests — so the backend needs somewhere like Render, Railway, or Fly.io
instead. Whichever you pick:

1. Deploy the `server/` directory with `npm install` / `npm start`.
2. Set its environment variables from `server/.env.example`, with
   `CLIENT_ORIGIN` set to your Vercel frontend's URL (this is also what
   CORS and Socket.io use to decide which origin may connect).
3. Point the Vercel frontend's `VITE_API_URL` at this backend's URL.

`server/wingd.db` and `server/uploads/` are both local disk — most of these
hosts wipe or don't persist local disk across deploys/restarts, so for
anything beyond a demo, swap `better-sqlite3` for a hosted database and
`multer`'s disk storage for something like S3 or Cloudinary.

## Trying the full flow

1. Sign up two accounts (the two pilots) and fill out their profiles.
2. From each pilot's **Co-pilots** page, generate an invite link and open it
   in another browser/incognito session signed in as a third/fourth account
   — those become the co-pilots.
3. As each pilot, go to **Discover** and like the other pilot to create a
   match.
4. As a co-pilot, go to **Matches** and open the **Co-pilot chat** for the
   new match, then vouch for it. Do the same for the other pilot's co-pilot.
5. Once both sides vouch, the pilots' **Matches** page unlocks a direct chat.

## Data model

- `users` — one account per person (can be a pilot and/or a co-pilot);
  `password_hash` is null for accounts created via Google/Apple sign-in.
- `pilot_profiles` — one dating profile per user.
- `copilot_links` — invite + acceptance linking a co-pilot to a pilot.
- `swipes` / `matches` — like/pass history and resulting matches.
- `copilot_messages` / `pilot_messages` — the two private chat rooms per
  match, access-controlled server-side.
