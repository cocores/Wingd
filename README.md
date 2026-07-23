# Wingd 🛩️

A dating app built around trust: every **pilot** (the person dating) brings
**co-pilots** — friends who vouch for them. When two pilots match, it's their
co-pilots who chat first, in a private room, to vet whether the match is a
good fit. Only once co-pilots on both sides give the green light do the
pilots themselves start chatting.

## How it works

1. **Sign up & build your pilot profile** — age, bio, location, and a
   photo you upload directly.
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

## Stack

- **Backend**: Node.js, Express, better-sqlite3, Socket.io (real-time chat),
  JWT auth, bcrypt password hashing, Multer (photo uploads).
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

- `users` — one account per person (can be a pilot and/or a co-pilot).
- `pilot_profiles` — one dating profile per user.
- `copilot_links` — invite + acceptance linking a co-pilot to a pilot.
- `swipes` / `matches` — like/pass history and resulting matches.
- `copilot_messages` / `pilot_messages` — the two private chat rooms per
  match, access-controlled server-side.
