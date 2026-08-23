# Wingd 🛩️

A dating app built around trust: every **pilot** (the person dating) brings a
**wing circle** — 2-5 friends who vote on who they're interested in before
that interest ever reaches the other person. A match only forms once both
sides' wings have independently signed off, and it arrives with context: how
many friends vouched, and what they said.

## How it works

1. **Sign up & build your pilot profile** — with email/password, or one tap
   via Google or Apple — then add your age, bio, a photo you upload directly,
   and a location you can either type (with city suggestions after 3
   characters) or detect automatically from your browser.
2. **Build your wing circle** — generate a shareable invite link; a friend
   who accepts it joins your circle (capped at 5).
3. **Discover & swipe** — browse other pilots (optionally filtered by age
   range or gender), like or pass. A like doesn't match instantly — it queues
   an interest for your own wing circle to review.
4. **Your wings weigh in** — each circle member votes approve/reject on your
   pending interests from the **Wing queue**, with an optional note. Once a
   majority approves, the interest is "sent." A circle of zero auto-sends
   (nothing to review).
5. **A match with context** — once both pilots' interests have independently
   been sent, a match forms immediately (the vetting already happened before
   either pilot found out). The **Matches** page shows how many wings vouched
   on each side and what they said, and pilot chat is unlocked right away.
6. **Anyone can walk away** — either pilot can unmatch at any time, which
   ends the match for good.

Nav badges keep everyone in the loop: new matches, unread wing/pilot
messages, pending votes in your wing queue, and new wing-circle acceptances
all show up as counts next to **Matches**, **Wing queue**, and **Wing
circle**.

## Stack

- **Backend**: Node.js, Express, Firestore (via `firebase-admin`), Socket.io
  (real-time chat), JWT auth, bcrypt password hashing, Google/Apple social
  sign-in verified server-side, Multer (photo uploads), a small proxy to
  OpenStreetMap's Nominatim for location search/detection (no API key needed).
- **Frontend**: React + Vite, React Router, socket.io-client, axios.

## Running locally

### 1. Backend

```bash
cd server
cp .env.example .env
npm install
npm run emulator   # in one terminal — starts the Firestore emulator on 127.0.0.1:8080
npm run dev        # in another — http://localhost:4000
```

The default `.env.example` values (`FIREBASE_PROJECT_ID=demo-wingd`,
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`) point the server at that local
emulator, so no real Firebase project or credentials are needed for local
dev. Data lives only in the emulator's memory — restarting it clears
everything.

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
with Socket.io) need to be deployed separately — there's no single
serverless platform that fits both.

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
needs, so the backend needs somewhere like Render, Railway, Fly.io, or
Cloud Run instead. Whichever you pick:

1. [Create a Firebase project](https://console.firebase.google.com/) (or a
   plain GCP project) and enable Firestore in it (Native mode).
2. Create a service account with the "Cloud Datastore User" role (IAM &
   Admin → Service Accounts → generate key) and download its JSON key.
3. Deploy the `server/` directory with `npm install` / `npm start`.
4. Set its environment variables from `server/.env.example`: `FIREBASE_PROJECT_ID`
   to your project's id, `GOOGLE_APPLICATION_CREDENTIALS` to wherever the host
   makes that service account JSON available (leave `FIRESTORE_EMULATOR_HOST`
   unset in production), and `CLIENT_ORIGIN` set to your Vercel frontend's URL
   (this is also what CORS and Socket.io use to decide which origin may
   connect).
5. Point the Vercel frontend's `VITE_API_URL` at this backend's URL.

`server/uploads/` is local disk — most of these hosts wipe or don't persist
local disk across deploys/restarts, so for anything beyond a demo, swap
`multer`'s disk storage for something like S3 or Cloudinary.

## Trying the full flow

The fastest way in: `npm run seed` (see below) creates four ready-to-use
accounts with a wing circle and a pending interest already queued. Or walk
through it manually:

1. Sign up two accounts (the two pilots) and fill out their profiles.
2. From each pilot's **Wing circle** page, generate an invite link and open
   it in another browser/incognito session signed in as a third/fourth
   account — those become their wings.
3. As each pilot, go to **Discover** and like the other pilot. This queues
   an interest for that pilot's own wing circle — nothing happens on the
   other pilot's side yet.
4. As a wing, go to **Wing queue** and approve the interest (optionally with
   a note). Once a majority of the circle approves, it's "sent."
5. Once both pilots' interests have independently been sent, a match forms
   automatically — check **Matches** to see the vouch counts/notes and open
   the pilot chat.

### Test accounts

`cd server && npm run seed` creates four accounts (password `password123`
for all): `alice@wingd.test` and `bob@wingd.test` as pilots, `wing1@wingd.test`
and `wing2@wingd.test` as Alice's wing circle. Alice's interest in Bob is
already queued in the wings' Wing queue, and Bob's interest in Alice (he has
no circle) has already auto-sent — so approving from either wing account
immediately produces a real match. Safe to re-run; it resets those four
accounts each time. Requires the Firestore emulator (or a real project) to
be reachable, same as the server itself.

## Data model

Firestore collections (see `server/src/firestore.js` and the route files for
exact shapes):

- `users` — one account per person (can be a pilot and/or a wing);
  `passwordHash` is absent for accounts created via Google/Apple sign-in.
  `emailIndex/{email}` holds `{ userId }` and is the atomic uniqueness
  constraint on email (doc id = lowercased email).
- `pilotProfiles` — one dating profile per user, doc id = user id.
- `copilotLinks` — invite + acceptance linking a wing to a pilot (capped at
  5 accepted per pilot).
- `swipes` — like/pass history, keyed by `{swiperId}__{targetId}`.
- `interests` — one-directional signal of interest, keyed by
  `{fromUserId}__{toUserId}`, status `pending_wings` → `sent` or
  `declined_by_wings`.
- `interestVotes` — one wing's vote + optional note on an interest, keyed by
  `{interestId}__{copilotUserId}`.
- `matches` — created once both directions of an interest are `sent`, keyed
  by a canonically-sorted `{pilotAId}__{pilotBId}`, referencing the two
  interests that led to it.
- `copilotMessages` / `pilotMessages` — the wing-circle chat (per interest)
  and pilot-to-pilot chat (per match), access-controlled server-side.

No browser code talks to Firestore directly — everything goes through the
Express API using `firebase-admin`, which is why `firestore.rules` denies
all client access by default.
