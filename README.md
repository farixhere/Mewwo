# Mewwo

Mewwo is a shared 3D virtual world where two people raise one little cat together. Feed, play, explore, and watch your kitten grow into an adult cat. With realistic cat behaviour, a living home, changing days and nights, and shared memories, Mewwo makes your little companion feel alive, even when you're apart. Two hearts, one little life.

> **Status: first complete draft.** The code was written without access to the npm registry, so it has **never been compiled or run in a browser**. The simulation core (needs, brain, offline progression, growth, navigation, placement rules, body-language model) is covered by 20 passing tests; everything else (Next.js pages, React Three Fiber scene, API routes) is type-checked only against stand-ins. Expect a handful of small fixes on the first real build, and expect to tune the look of the cat and room once you see them. See [Known limitations](#known-limitations).

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Three.js + React Three Fiber + Drei · Zustand · Neon PostgreSQL · Drizzle ORM · Zod · `jose` (signed session cookies) · `bcryptjs`.

## Run it

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL and AUTH_SECRET
npm run db:migrate                # applies db/migrations/*.sql (safe to re-run)
npm run db:seed                   # optional: demo household with two accounts (never in production)
npm run dev
```

`npm test` runs the simulation tests (Node 22+, no extra dependencies).

**Neon:** a project named `mewwo` has already been created and migrated (project id `green-bird-74538657`, region `aws-ap-southeast-1`). Copy its pooled connection string from the Neon console into `DATABASE_URL`. `db:migrate` will report every migration as already applied.

**Deploy (Vercel):** functions are pinned to `sin1` (Singapore, `vercel.json`) to sit next to the Neon database in `aws-ap-southeast-1`; each game request makes about 15 queries, so distance to the database matters. If you move the database, move the region with it.

**Deploy steps:** import the repo, set `DATABASE_URL`, `AUTH_SECRET` (`openssl rand -base64 48`) and `NEXT_PUBLIC_SITE_URL`, deploy. No secrets are ever sent to the browser; all game mutations go through server routes.

## How it works

```
Browser (R3F scene + Zustand)           Server (Next route handlers)            Neon
  tap ──► POST /api/action  ───────────►  one transaction:                        
  poll ─► GET  /api/state   ───────────►   1. lock household row (FOR UPDATE)  ──►  households, cats, cat_state,
  ◄────── authoritative state             2. advance cat to "now"                   placed_objects, inventory,
                                           3. validate + apply the action            memories, ...
                                           4. persist, bump households.rev
```

- **The server is the only source of truth.** Clients never decide outcomes; optimistic updates are reconciled with the authoritative state returned by every action and every poll.
- **No double-applied time or food.** Every read and write locks the household row. Two simultaneous feeds serialise; the second sees the bowl already full and consumes nothing. Pantry decrements are also guarded (`quantity >= 1`) in SQL.
- **Offline progression** (`lib/sim/engine.ts`) is a pure function: saved state in, new state out. It advances in bounded 5-minute steps, replays at most the last 36 hours, caps iterations, and fast-forwards anything older (growth stages still fire in order, once). Decisions use a counter-based RNG, so the same saved state always replays identically.
- **Forgiving by design.** Needs have floors (she gets hungry and wistful, never harmed); stress is capped; the pantry refills every few hours; relationships never decay into punishment.
- **The cat's life** (`lib/sim/brain.ts`) is utility-based: eligibility rules, urgent-need overrides, softmax-style controlled randomness, anti-repetition, sequencing (eat → groom, wake → stretch), per-cat chronotype (no two cats share a schedule), learned toy and sleeping-spot preferences, familiarity that dulls the novelty of objects, and a stage-dependent behaviour profile (kittens sleep more, play more, can't go outside until the garden unlocks).
- **Both players see the same cat in the same place** without streaming positions: each client derives the walking path and progress from the saved activity and the shared clock (`lib/client/motion.ts`, same nav code as the server).
- **Body language is contextual** (`lib/client/pose.ts`): a lashing tail means excitement while stalking a toy, nothing while sleeping, and a quiet upright tail is a greeting. Stress colours posture but never overrides the activity.
- **Growth** follows the real clock (`lib/sim/growth.ts`): young kitten → growing kitten (day 14) → adolescent (day 60) → adult (day 180), with proportion changes (big head, short legs, clumsiness), not just scale. Clicking more never speeds it up.
- **Real-time** is behind a `Transport` interface (`lib/client/realtime.ts`). The shipped implementation is polling (5 s visible, 30 s hidden, backoff and an authoritative refresh on reconnect, plus a timed refresh when the cat's activity ends). Swap in Ably/Pusher by implementing `Transport` and publishing a ping after each committed change.
- **Placement rules** (`lib/world/nav.ts`): furniture can't overlap, leave the room, seal the cat in, cut her off from food, water, bed, litter or a scratching post, or put the litter tray near her bowls. Concurrent moves use per-object version checks.

## Project layout

```
app/                 Next.js pages and API routes
components/          UI (HUD, sheets, auth) and scene/ (3D)
lib/sim/             Pure simulation: needs, brain, engine, growth, personality, learning
lib/world/           Catalog, navigation grid, A*, placement validation
lib/server/          DB, auth, game service (all authoritative logic)
lib/client/          Store, transport, motion, pose, audio
db/migrations/       SQL migrations (applied by scripts/migrate.ts)
db/schema.ts         Typed Drizzle mirror of the SQL
tests/               Simulation tests (node --test)
```

Adding an object type: add it to `OBJECT_DEFS` in `lib/world/catalog.ts`, draw it in `components/scene/Props.tsx`. The brain, navigation, placement checks and UI pick it up through its tags.

## Known limitations

Honest list, roughly by importance:

1. **Never built or seen.** No compile, no browser run. The cat model and room are procedural and unviewed; proportions, camera framing, light levels and animation will need tuning.
2. **Procedural cat, not a rigged model.** `components/scene/CatModel.tsx` is the single swap point: replace its body with a GLTF and keep `poseFor` as the driver.
3. **Polling, not push.** Partners see changes within about five seconds.
4. **Auth is minimal.** No email verification, password reset, or rate limiting yet. Add them before opening this to the public.
5. **Drizzle schema is hand-mirrored** from the SQL migrations (checked once against the live database). The SQL files are what actually define the database.
6. **Garden is the only extra location.** Neighbourhood and park are shown as "coming later". No currency or shop yet (the inventory table is ready for it).
7. **Audio is synthesized** (purr, meow, scratch, footsteps, room tone, birds) and untuned; there are no recorded samples.
8. **Presence-based reactions are coarse.** The cat treats the household as "here" if anyone was active in the last three minutes.
