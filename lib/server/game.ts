import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema as s, type Tx } from './db';
import { stateColumns, toCatSim, toWorldObject } from './mappers';
import { hashInvite, newInviteCode } from './auth';
import { AWAY_MS, FLAG, bondGain, describeTraits, greetPull, ownerKey, ownerProfile, traitsOf, type OwnerBond } from '../sim/bond';
import { advance, noteNewObject, reactToPerson } from '../sim/engine';
import { ACTIVITY_DEFS } from '../sim/activities';
import { careHints, activityLabel, moodWord } from '../sim/describe';
import { ageDays, proportionsFor, stageForAge, stageLabel } from '../sim/growth';
import { defaultNeeds } from '../sim/needs';
import { rollPersonality } from '../sim/personality';
import { decisionRng, mulberry32, hashString } from '../sim/rng';
import { reinforce, familiarize } from '../sim/learning';
import { daylight, localHour } from '../sim/time';
import type { CatSim, SimEvent, WorldObject } from '../sim/types';
import { canHearCall, decideReaction, decodeReaction, encodeReaction, petStreak, voiceTraits, type EventKind } from '../sim/voice';
import { pickDestination } from '../world/place';
import { GARDEN_SEED, HOME_SEED, LOCATIONS, OBJECT_DEFS, STARTING_INVENTORY, defOf } from '../world/catalog';
import { buildGrid, nearestFreeCell, cellCenter, validatePlacement } from '../world/nav';

export class GameError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const PRESENCE_MS = 3 * MINUTE;
const PERSIST_EVERY_MS = 60_000;
const INVENTORY_RULES: Record<string, { max: number; everyMs: number }> = {
  kibble: { max: 12, everyMs: 3 * HOUR },
  treat: { max: 3, everyMs: 12 * HOUR },
};

// ---------- schemas ----------

export const registerInput = z.object({
  email: z.string().email().max(200).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(40),
});
export const loginInput = z.object({ email: z.string().email().transform((v) => v.trim().toLowerCase()), password: z.string().min(1).max(200) });
export const createHouseholdInput = z.object({
  name: z.string().trim().min(1).max(60),
  catName: z.string().trim().min(1).max(30),
  timeZone: z.string().max(60).default('UTC'),
});
export const joinInput = z.object({ code: z.string().min(4).max(20) });

export const actionInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('feed'), bowlId: z.string().uuid() }),
  z.object({ type: z.literal('water'), bowlId: z.string().uuid() }),
  z.object({ type: z.literal('pet') }),
  z.object({ type: z.literal('play'), toyId: z.string().uuid() }),
  z.object({ type: z.literal('treat') }),
  z.object({ type: z.literal('call'), x: z.number().finite(), z: z.number().finite() }),
  z.object({
    type: z.literal('move'), objectId: z.string().uuid(),
    x: z.number().finite(), z: z.number().finite(), rotation: z.number().finite().default(0),
    expectedVersion: z.number().int().optional(),
  }),
]);
export type ActionInput = z.infer<typeof actionInput>;

function validTimeZone(tz: string): string {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

// ---------- accounts and households ----------

export async function registerUser(input: z.infer<typeof registerInput>, passwordHash: string) {
  const db = getDb();
  const existing = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, input.email)).limit(1);
  if (existing.length) throw new GameError(409, 'That email already has an account.');
  const [u] = await db.insert(s.users).values({ email: input.email, passwordHash, displayName: input.displayName }).returning({ id: s.users.id });
  return u!.id;
}

export async function findUserByEmail(email: string) {
  const rows = await getDb().select().from(s.users).where(eq(s.users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function membershipOf(userId: string) {
  const rows = await getDb().select({ householdId: s.householdMembers.householdId })
    .from(s.householdMembers).where(eq(s.householdMembers.userId, userId)).limit(1);
  return rows[0]?.householdId ?? null;
}

export async function whoAmI(userId: string) {
  const db = getDb();
  const [u] = await db.select({ id: s.users.id, name: s.users.displayName, email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1);
  if (!u) return null;
  return { ...u, householdId: await membershipOf(userId) };
}

export async function createHousehold(userId: string, input: z.infer<typeof createHouseholdInput>) {
  return getDb().transaction(async (tx) => {
    const already = await tx.select().from(s.householdMembers).where(eq(s.householdMembers.userId, userId)).limit(1);
    if (already.length) throw new GameError(409, 'You already belong to a household.');
    const now = new Date();
    const [h] = await tx.insert(s.households).values({ name: input.name, timeZone: validTimeZone(input.timeZone), createdBy: userId }).returning();
    await tx.insert(s.householdMembers).values({ householdId: h!.id, userId, role: 'owner', lastSeenAt: now });
    const [cat] = await tx.insert(s.cats).values({ householdId: h!.id, name: input.catName, coatSeed: 1 + (hashString(input.catName + h!.id) % 6), bornAt: now }).returning();
    const p = rollPersonality(cat!.id);
    await tx.insert(s.catPersonality).values({ catId: cat!.id, ...p, preferences: {} });
    const bed = HOME_SEED.find((o) => o.type === 'cat_bed')!;
    await tx.insert(s.catState).values({
      catId: cat!.id, lastSimAt: now, activity: 'idle', activitySince: now, activityUntil: now,
      posX: bed.x, posZ: bed.z, ...Object.fromEntries(Object.entries(defaultNeeds()).map(([k, v]) => [k === 'curiosity' ? 'curiosityDrive' : k, v])),
    });
    await tx.insert(s.catRelationships).values({ catId: cat!.id, userId });
    await tx.insert(s.placedObjects).values(HOME_SEED.map((o) => ({
      householdId: h!.id, locationId: o.location, objectType: o.type, x: o.x, z: o.z, rotation: o.rotation, movable: o.movable, state: o.state,
    })));
    await tx.insert(s.householdLocations).values({ householdId: h!.id, locationId: 'home' });
    await tx.insert(s.inventoryItems).values(Object.entries(STARTING_INVENTORY).map(([itemType, quantity]) => ({ householdId: h!.id, itemType, quantity })));
    await tx.insert(s.memories).values({
      householdId: h!.id, kind: 'arrival', title: `${input.catName} comes home`, body: 'A tiny new life, and a whole house to explore.', userId, occurredAt: now, dedupeKey: 'arrival',
    });
    return h!.id;
  });
}

export async function createInvite(userId: string) {
  const hid = await membershipOf(userId);
  if (!hid) throw new GameError(400, 'Create a household first.');
  return getDb().transaction(async (tx) => {
    await tx.select().from(s.households).where(eq(s.households.id, hid)).for('update');
    const members = await tx.select({ n: sql<number>`count(*)::int` }).from(s.householdMembers).where(eq(s.householdMembers.householdId, hid));
    if ((members[0]?.n ?? 0) >= 2) throw new GameError(409, 'Your household already has two people.');
    const { code, hash } = newInviteCode();
    await tx.insert(s.invitations).values({ householdId: hid, codeHash: hash, createdBy: userId, expiresAt: new Date(Date.now() + 7 * 24 * HOUR) });
    return { code, expiresInDays: 7 };
  });
}

export async function joinHousehold(userId: string, rawCode: string) {
  return getDb().transaction(async (tx) => {
    const has = await tx.select().from(s.householdMembers).where(eq(s.householdMembers.userId, userId)).limit(1);
    if (has.length) throw new GameError(409, 'You already belong to a household.');
    const inv = (await tx.select().from(s.invitations).where(eq(s.invitations.codeHash, hashInvite(rawCode))).for('update').limit(1))[0];
    // Same message for unknown / used / expired so codes can't be probed.
    if (!inv || inv.usedAt || inv.expiresAt.getTime() < Date.now()) throw new GameError(400, 'That invitation code isn\'t valid any more.');
    await tx.select().from(s.households).where(eq(s.households.id, inv.householdId)).for('update');
    const count = (await tx.select({ n: sql<number>`count(*)::int` }).from(s.householdMembers).where(eq(s.householdMembers.householdId, inv.householdId)))[0]?.n ?? 0;
    if (count >= 2) throw new GameError(409, 'That household is already full.');
    const now = new Date();
    await tx.insert(s.householdMembers).values({ householdId: inv.householdId, userId, role: 'member', lastSeenAt: now });
    await tx.update(s.invitations).set({ usedBy: userId, usedAt: now }).where(eq(s.invitations.id, inv.id));
    const cat = (await tx.select().from(s.cats).where(eq(s.cats.householdId, inv.householdId)).limit(1))[0]!;
    await tx.insert(s.catRelationships).values({ catId: cat.id, userId }).onConflictDoNothing();
    const [u] = await tx.select({ n: s.users.displayName }).from(s.users).where(eq(s.users.id, userId));
    await tx.insert(s.memories).values({
      householdId: inv.householdId, kind: 'second_owner', title: `${u?.n ?? 'Someone'} joins the household`,
      body: `Now ${cat.name} has two people to love.`, userId, occurredAt: now, dedupeKey: 'second_owner',
    }).onConflictDoNothing();
    await bump(tx, inv.householdId);
    return inv.householdId;
  });
}

async function bump(tx: Tx, householdId: string) {
  await tx.update(s.households).set({ rev: sql`${s.households.rev} + 1` }).where(eq(s.households.id, householdId));
}

// ---------- the locked household context ----------

interface Ctx {
  tx: Tx;
  userId: string;
  userName: string;
  householdId: string;
  householdName: string;
  timeZone: string;
  rev: number;
  catRow: typeof s.cats.$inferSelect;
  sim: CatSim;
  objects: WorldObject[];
  versions: Map<string, number>;
  inventory: Map<string, { id: string; qty: number }>;
  relationship: typeof s.catRelationships.$inferSelect;
  /** Everyone in the household, and the cat's relationship row with each. */
  members: { id: string; name: string; seen: Date | null }[];
  rels: (typeof s.catRelationships.$inferSelect)[];
  /** The acting owner's relationship row needs saving (time together). */
  relDirty: boolean;
  now: number;
  hour: number;
  changed: boolean;
  events: SimEvent[];
}

/**
 * Everything that reads or changes shared state runs through here: one transaction, one row lock on the
 * household. Two requests can therefore never apply the same elapsed interval, or the same bowl portion, twice.
 */
async function withHousehold<T>(userId: string, fn: (c: Ctx) => Promise<T>, opts: { write: boolean }): Promise<T> {
  return getDb().transaction(async (tx) => {
    // One query finds the household and who is asking (it used to be two queries, one outside the transaction).
    const [me] = await tx.select({ hid: s.householdMembers.householdId, n: s.users.displayName })
      .from(s.householdMembers).innerJoin(s.users, eq(s.users.id, s.householdMembers.userId))
      .where(eq(s.householdMembers.userId, userId)).limit(1);
    if (!me) throw new GameError(404, 'No household yet.');
    const hid = me.hid;
    const [h] = await tx.select().from(s.households).where(eq(s.households.id, hid)).for('update');
    if (!h) throw new GameError(404, 'Household not found.');
    const now = Date.now();
    const user = { n: me.n };
    // The cat, its state and its personality in a single round trip.
    const [joined] = await tx.select({ cat: s.cats, st: s.catState, pers: s.catPersonality }).from(s.cats)
      .innerJoin(s.catState, eq(s.catState.catId, s.cats.id))
      .innerJoin(s.catPersonality, eq(s.catPersonality.catId, s.cats.id))
      .where(eq(s.cats.householdId, hid)).limit(1);
    if (!joined) throw new GameError(404, 'No cat found.');
    const catRow = joined.cat, st = joined.st, pers = joined.pers;
    const objRows = await tx.select().from(s.placedObjects).where(eq(s.placedObjects.householdId, hid));
    const invRows = await tx.select().from(s.inventoryItems).where(eq(s.inventoryItems.householdId, hid));
    const members = (await tx.select({ id: s.users.id, name: s.users.displayName, seen: s.householdMembers.lastSeenAt })
      .from(s.householdMembers).innerJoin(s.users, eq(s.users.id, s.householdMembers.userId))
      .where(eq(s.householdMembers.householdId, hid))).map((m) => ({ id: m.id, name: m.name, seen: m.seen ? new Date(m.seen as unknown as string) : null }));
    const rels = await tx.select().from(s.catRelationships).where(eq(s.catRelationships.catId, catRow.id));
    const rel = rels.find((r) => r.userId === userId)
      ?? (await tx.insert(s.catRelationships).values({ catId: catRow.id, userId }).returning())[0]!;
    if (!rels.includes(rel)) rels.push(rel);
    const prevSeen = members.find((m) => m.id === userId)?.seen?.getTime() ?? null;

    const ctx: Ctx = {
      tx, userId, userName: user?.n ?? 'Someone', householdId: hid, householdName: h.name, timeZone: h.timeZone, rev: Number(h.rev),
      catRow, sim: toCatSim(catRow, st, pers), objects: objRows.map(toWorldObject),
      versions: new Map(objRows.map((o) => [o.id, o.version])),
      inventory: new Map(invRows.map((i) => [i.itemType, { id: i.id, qty: i.quantity }])),
      relationship: rel, members, rels, relDirty: false, now, hour: localHour(now, h.timeZone), changed: false, events: [],
    };
    const originalObjects = new Map(ctx.objects.map((o) => [o.id, JSON.stringify([o.x, o.z, o.rotation, o.state])]));

    // 1. Growth may unlock the garden.
    await maybeUnlockGarden(ctx);
    // 2. Pantry refills slowly so nobody is ever stuck.
    await regenInventory(ctx, invRows);
    // 3. Welcome back: an owner returning after a while gets a greeting (noted once; she acts on it when she next chooses).
    let greeted = false;
    if (prevSeen && now - prevSeen > AWAY_MS) {
      ctx.sim = { ...ctx.sim, familiarity: { ...ctx.sim.familiarity, [FLAG.greetFor]: ownerKey(userId), [FLAG.greetAt]: now } };
      greeted = true;
    }
    accrueTogether(ctx, prevSeen);
    const owners = ownersOf(ctx);
    const anyoneHere = owners.some((o) => o.here);

    // 4. Bring the cat up to the present.
    const before = ctx.sim.rngCounter;
    const r = advance(ctx.sim, ctx.objects, now, { timeZone: h.timeZone, anyoneHere, owners });
    ctx.sim = r.cat;
    ctx.objects = r.objects;
    ctx.events.push(...r.events);
    const decisionsMade = r.cat.rngCounter !== before;
    const objectsMoved = ctx.objects.some((o) => originalObjects.get(o.id) !== JSON.stringify([o.x, o.z, o.rotation, o.state]));
    const stale = now - st.lastSimAt.getTime() >= PERSIST_EVERY_MS;
    const mustPersist = opts.write || decisionsMade || objectsMoved || r.events.length > 0 || stale || greeted || ctx.relDirty;

    const result = await fn(ctx);

    const objectsNow = ctx.objects.some((o) => originalObjects.get(o.id) !== JSON.stringify([o.x, o.z, o.rotation, o.state]));
    if (mustPersist || ctx.changed || objectsNow) {
      await persist(ctx, originalObjects, r.steps, st.lastSimAt.getTime());
      if (decisionsMade || ctx.changed || ctx.events.length) await bump(tx, hid);
    }
    // Presence (throttled so polling doesn't turn into a write storm).
    await tx.update(s.householdMembers).set({ lastSeenAt: new Date(now) })
      .where(and(eq(s.householdMembers.householdId, hid), eq(s.householdMembers.userId, userId),
        sql`(${s.householdMembers.lastSeenAt} is null or ${s.householdMembers.lastSeenAt} < now() - interval '30 seconds')`));
    return result;
  });
}

/** Who is around right now, and how the cat feels about each of them. Both owners are always represented. */
function ownersOf(c: Ctx): OwnerBond[] {
  return c.members.map((m) => {
    const r = c.rels.find((x) => x.userId === m.id);
    const prof = r ? ownerProfile(r.interactionCounts, r.familiarity, r.recentPositive) : { bond: 0.15, play: 0.5, quiet: 0.5 };
    const here = m.id === c.userId || (!!m.seen && c.now - m.seen.getTime() < PRESENCE_MS);
    return { id: m.id, key: ownerKey(m.id), here, bond: prof.bond, play: prof.play, quiet: prof.quiet };
  });
}

/**
 * Time together grows a bond slowly. Counted in coarse steps (so polling never turns into a write storm) and only while
 * that person is actually around; the other owner's row is never touched.
 */
function accrueTogether(c: Ctx, prevSeen: number | null) {
  const counts = c.relationship.interactionCounts;
  const last = counts['~tog_at'];
  if (last !== undefined && c.now - last < 45_000) return;
  let fam = c.relationship.familiarity;
  const next: Record<string, number> = { ...counts, '~tog_at': c.now };
  if (last !== undefined && c.now - last < 3 * MINUTE && prevSeen !== null) {
    const mins = (c.now - last) / MINUTE;
    next['~tog'] = (counts['~tog'] ?? 0) + mins;
    fam = Math.min(1, fam + 0.0015 * mins * (1.1 - fam));
  }
  c.relationship = { ...c.relationship, interactionCounts: next, familiarity: fam };
  c.rels = c.rels.map((r) => (r.userId === c.userId ? c.relationship : r));
  c.relDirty = true;
}

async function persist(c: Ctx, original: Map<string, string>, steps: number, prevSimAt: number) {
  const { tx, sim } = c;
  const personalityUpdate = { preferences: sim.preferences, updatedAt: new Date() };
  await tx.update(s.catPersonality).set(personalityUpdate).where(eq(s.catPersonality.catId, sim.id));
  await tx.update(s.catState).set({
    ...stateColumns(sim),
    growth: Math.min(1, ageDays(sim.bornAt, c.now) / 180),
    version: sql`${s.catState.version} + 1`,
  }).where(eq(s.catState.catId, sim.id));
  for (const o of c.objects) {
    if (original.get(o.id) === JSON.stringify([o.x, o.z, o.rotation, o.state])) continue;
    await tx.update(s.placedObjects).set({ x: o.x, z: o.z, rotation: o.rotation, state: o.state, version: sql`${s.placedObjects.version} + 1`, updatedAt: new Date() })
      .where(eq(s.placedObjects.id, o.id));
  }
  for (const e of c.events) {
    await tx.insert(s.memories).values({
      householdId: c.householdId, kind: e.kind, title: e.title, body: e.body ?? null, objectId: e.objectId && isUuid(e.objectId) ? e.objectId : null,
      userId: e.userId && isUuid(e.userId) ? e.userId : null, occurredAt: new Date(e.at), dedupeKey: e.dedupeKey,
    }).onConflictDoNothing();
  }
  if (c.relDirty) await saveRelationship(c);
  if (steps > 0) {
    await tx.insert(s.simCheckpoints).values({ catId: sim.id, fromAt: new Date(prevSimAt), toAt: new Date(c.now), steps });
  }
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function maybeUnlockGarden(c: Ctx) {
  if (c.objects.some((o) => o.location === 'garden')) return; // already unlocked: no query needed
  if (stageForAge(ageDays(c.sim.bornAt, c.now)) === 'young_kitten') return;
  const have = await c.tx.select().from(s.householdLocations)
    .where(and(eq(s.householdLocations.householdId, c.householdId), eq(s.householdLocations.locationId, 'garden'))).limit(1);
  if (have.length) return;
  await c.tx.insert(s.householdLocations).values({ householdId: c.householdId, locationId: 'garden' }).onConflictDoNothing();
  const rows = await c.tx.insert(s.placedObjects).values(GARDEN_SEED.map((o) => ({
    householdId: c.householdId, locationId: o.location, objectType: o.type, x: o.x, z: o.z, rotation: o.rotation, movable: o.movable, state: o.state,
  }))).returning();
  for (const r of rows) { c.objects.push(toWorldObject(r)); c.versions.set(r.id, r.version); }
  c.events.push({ kind: 'garden_unlocked', dedupeKey: 'garden_unlocked', title: 'The garden door is open', body: 'A whole new world of smells and birds.', at: c.now });
  c.changed = true;
}

async function regenInventory(c: Ctx, rows: (typeof s.inventoryItems.$inferSelect)[]) {
  for (const row of rows) {
    const rule = INVENTORY_RULES[row.itemType];
    if (!rule) continue;
    let qty = row.quantity;
    let at = row.updatedAt.getTime();
    if (qty >= rule.max) { at = c.now; }
    else {
      const n = Math.floor((c.now - at) / rule.everyMs);
      if (n <= 0) continue;
      qty = Math.min(rule.max, qty + n);
      at = qty >= rule.max ? c.now : at + n * rule.everyMs;
    }
    if (qty === row.quantity && Math.abs(at - row.updatedAt.getTime()) < 60 * MINUTE) continue;
    await c.tx.update(s.inventoryItems).set({ quantity: qty, updatedAt: new Date(at) }).where(eq(s.inventoryItems.id, row.id));
    c.inventory.set(row.itemType, { id: row.id, qty });
  }
}

// ---------- reading state ----------

/**
 * Cheap poll: has anything changed since the revision the client already has? One small query, no row lock,
 * no simulation. Most polls take this path, so taps never queue behind a heavy refresh.
 * Falls through to a full read when the cat's activity is about to end, since her state is due to move on.
 */
export async function stateUnchanged(userId: string, clientRev: number): Promise<boolean> {
  const db = getDb();
  const [r] = await db.select({ rev: s.households.rev, until: s.catState.activityUntil, hid: s.householdMembers.householdId, seen: s.householdMembers.lastSeenAt })
    .from(s.householdMembers)
    .innerJoin(s.households, eq(s.households.id, s.householdMembers.householdId))
    .innerJoin(s.cats, eq(s.cats.householdId, s.households.id))
    .innerJoin(s.catState, eq(s.catState.catId, s.cats.id))
    .where(eq(s.householdMembers.userId, userId)).limit(1);
  if (!r) return false;
  const now = Date.now();
  if (Number(r.rev) !== clientRev || now >= r.until.getTime() - 1500) return false;
  // Coming back after a while needs the full path, which is where the cat notices and greets them.
  if (!r.seen || now - new Date(r.seen as unknown as string).getTime() > AWAY_MS) return false;
  // Still count as present (throttled, so polling does not become a write storm).
  await db.update(s.householdMembers).set({ lastSeenAt: new Date(now) })
    .where(and(eq(s.householdMembers.householdId, r.hid), eq(s.householdMembers.userId, userId),
      sql`(${s.householdMembers.lastSeenAt} is null or ${s.householdMembers.lastSeenAt} < now() - interval '30 seconds')`));
  return true;
}

export async function readState(userId: string) {
  return withHousehold(userId, (c) => buildView(c), { write: false });
}

async function buildView(c: Ctx) {
  const { tx, sim } = c;
  const members = c.members.map((m) => ({ ...m, seen: m.seen as Date | null }));
  const mems = await tx.select().from(s.memories).where(eq(s.memories.householdId, c.householdId)).orderBy(desc(s.memories.occurredAt)).limit(60);
  const locs = await tx.select({ id: s.householdLocations.locationId }).from(s.householdLocations).where(eq(s.householdLocations.householdId, c.householdId));
  const rels = c.rels;
  const age = ageDays(sim.bornAt, c.now);
  const n = sim.needs;
  const q = (v: number) => Math.round(v * 20) / 20;
  const dl = daylight(c.hour);
  return {
    rev: c.rev,
    now: c.now,
    me: { id: c.userId, name: c.userName },
    household: {
      id: c.householdId, name: c.householdName, timeZone: c.timeZone, hour: c.hour, daylight: dl,
      members: members.map((m) => ({ id: m.id, name: m.name, online: !!m.seen && c.now - new Date(m.seen as unknown as string).getTime() < PRESENCE_MS })),
      canInvite: members.length < 2,
    },
    cat: {
      id: sim.id, name: c.catRow.name, coatSeed: c.catRow.coatSeed, bornAt: sim.bornAt, ageDays: age,
      stage: sim.stage, stageLabel: stageLabel(sim.stage), proportions: proportionsFor(age),
      traits: (() => { const t = traitsOf(sim.personality, sim.id); return describeTraits(t, sim.personality.cautiousness); })(),
      traits6: (() => { const t = traitsOf(sim.personality, sim.id); return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 100) / 100])) as Record<string, number>; })(),
      social: socialView(c),
      personality: Object.fromEntries(Object.entries(sim.personality).map(([k, v]) => [k, Math.round(v * 100) / 100])) as Record<string, number>,
      reaction: (() => { const rx = decodeReaction(sim.familiarity); return rx ? { ...rx, byMe: rx.by === hashString(c.userId) % 1_000_000 } : null; })(),
      favourites: Object.fromEntries(Object.entries(sim.preferences).filter(([, v]) => v >= 0.45).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      activity: sim.activity, activityLabel: activityLabel(sim.activity), asleep: !ACTIVITY_DEFS[sim.activity].awake,
      mood: moodWord(n, sim.activity), hints: careHints(n),
      targetId: sim.targetId, x: sim.x, z: sim.z, destX: sim.destX, destZ: sim.destZ, location: sim.location,
      activitySince: sim.activitySince, activityUntil: sim.activityUntil,
      needs: { food: q(n.satiety), water: q(n.hydration), energy: q(n.energy), comfort: q(n.comfort), play: q(n.play), social: q(n.social), calm: q(1 - n.stress), clean: q(n.grooming), litter: q(n.elimination) },
    },
    objects: c.objects.map((o) => ({ ...o, version: c.versions.get(o.id) ?? 1 })),
    inventory: Object.fromEntries([...c.inventory.entries()].map(([k, v]) => [k, v.qty])),
    locations: locs.map((l) => l.id),
    memories: mems.map((m) => ({ id: m.id, kind: m.kind, title: m.title, body: m.body, at: m.occurredAt.getTime(), by: members.find((x) => x.id === m.userId)?.name ?? null })),
    relationships: rels.map((r) => ({
      userId: r.userId, name: members.find((m) => m.id === r.userId)?.name ?? 'Someone',
      familiarity: Math.round(r.familiarity * 100) / 100,
      favourite: Object.entries(r.interactionCounts).filter(([k]) => !k.startsWith('~')).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      style: ownerProfile(r.interactionCounts, r.familiarity, r.recentPositive).style,
    })),
  };
}

/** Who she is currently turning toward and why, so every client voices the same greeting or invitation. */
function socialView(c: Ctx) {
  const fam = c.sim.familiarity;
  const toward = c.members.find((m) => ownerKey(m.id) === fam[FLAG.focus]);
  const rel = toward ? c.rels.find((r) => r.userId === toward.id) : undefined;
  const style = rel ? ownerProfile(rel.interactionCounts, rel.familiarity, rel.recentPositive).style : 'new';
  const social = ['approach_person', 'rub', 'seek_attention'].includes(c.sim.activity) && fam[FLAG.initAt] !== undefined && fam[FLAG.initAt]! >= c.sim.activitySince - 1000;
  return {
    toward: social && toward ? toward.id : null,
    style,
    greeting: social && !!toward && c.sim.activity === 'approach_person' && greetPull(fam, ownerKey(toward.id), c.now) > 0,
    invite: social && fam[FLAG.inviteAt] === c.sim.activitySince,
  };
}

// ---------- actions ----------

export type GameView = Awaited<ReturnType<typeof buildView>>;

export interface ActionResult { ok: boolean; message: string; state: Awaited<ReturnType<typeof buildView>> }

export async function performAction(userId: string, action: ActionInput): Promise<ActionResult> {
  return withHousehold(userId, async (c) => {
    const message = await applyAction(c, action);
    await recordInteraction(c, action);
    c.changed = true;
    return { ok: true, message, state: await buildView(c) };
  }, { write: true });
}

function toy(c: Ctx, id: string) {
  const o = c.objects.find((x) => x.id === id);
  if (!o) throw new GameError(404, 'That object isn\'t in the house any more.');
  return o;
}

async function spend(c: Ctx, itemType: string, label: string) {
  const row = c.inventory.get(itemType);
  if (!row || row.qty < 1) throw new GameError(409, `No ${label} left right now. More arrives every few hours.`);
  const updated = await c.tx.update(s.inventoryItems).set({ quantity: sql`${s.inventoryItems.quantity} - 1`, updatedAt: new Date() })
    .where(and(eq(s.inventoryItems.id, row.id), sql`${s.inventoryItems.quantity} >= 1`)).returning({ q: s.inventoryItems.quantity });
  if (!updated.length) throw new GameError(409, `No ${label} left right now.`);
  row.qty = updated[0]!.q;
}

async function applyAction(c: Ctx, a: ActionInput): Promise<string> {
  const { sim } = c;
  const catName = c.catRow.name;
  const rng = decisionRng(sim.id, sim.rngCounter + 104729);
  const bumpRel = (kind: string) => {
    const counts = c.relationship.interactionCounts;
    // Diminishing returns, and the same kind of interaction repeated within seconds counts for nothing.
    const gain = bondGain(c.relationship.familiarity, c.now - (counts[`~t_${kind}`] ?? 0));
    c.relationship = {
      ...c.relationship,
      familiarity: Math.min(1, c.relationship.familiarity + gain),
      recentPositive: Math.min(1, c.relationship.recentPositive + (gain > 0 ? 0.1 : 0.01)),
      interactionCounts: gain > 0 ? { ...counts, [kind]: (counts[kind] ?? 0) + 1, [`~t_${kind}`]: c.now } : counts,
      lastInteractionAt: new Date(c.now),
    };
    c.rels = c.rels.map((r) => (r.userId === c.userId ? c.relationship : r));
  };
  /** Record how the cat reacts to what was just done, so both owners see and hear the same thing. */
  const speak = (kind: EventKind, o: { distance?: number; streak?: number; x?: number; z?: number } = {}) => {
    const rx = decideReaction({
      kind, catId: sim.id, salt: c.now, personality: sim.personality, needs: c.sim.needs, activity: sim.activity,
      distance: o.distance, familiarity: c.relationship.familiarity, streak: o.streak,
    });
    c.sim.familiarity = { ...c.sim.familiarity };
    encodeReaction(c.sim.familiarity, rx, c.now, c.userId, o.x, o.z);
  };
  const memory = async (kind: string, title: string, body?: string) => {
    c.events.push({ kind: kind as SimEvent['kind'], dedupeKey: `${kind}:${c.userId}`, title, body, userId: c.userId, at: c.now });
  };

  switch (a.type) {
    case 'feed': {
      const bowl = toy(c, a.bowlId);
      if (bowl.type !== 'food_bowl') throw new GameError(400, 'That isn\'t a food bowl.');
      const amount = Number(bowl.state.amount ?? 0);
      if (amount >= 0.9) throw new GameError(409, 'The bowl is already full.');
      await spend(c, 'kibble', 'kibble');
      bowl.state = { ...bowl.state, amount: Math.min(1, amount + 0.6) };
      bumpRel('feed');
      await memory('first_feed', `${c.userName} fills the bowl for the first time`);
      return `Fresh kibble for ${catName}.`;
    }
    case 'water': {
      const bowl = toy(c, a.bowlId);
      if (bowl.type !== 'water_bowl') throw new GameError(400, 'That isn\'t a water bowl.');
      if (Number(bowl.state.amount ?? 0) >= 0.9) throw new GameError(409, 'The water is already fresh.');
      bowl.state = { ...bowl.state, amount: 1 };
      bumpRel('water');
      return 'Fresh water poured.';
    }
    case 'pet': {
      const fam = { ...sim.familiarity };
      const traits = voiceTraits(sim.personality, sim.id);
      const sleeping = !ACTIVITY_DEFS[sim.activity].awake;
      const ps = petStreak(fam, c.now, traits);
      if (ps.overstim && !sleeping) {
        // Enough fuss. She turns away and pads off for a bit; nothing punitive, and it passes.
        const grid = buildGrid(sim.location, c.objects);
        const dest = pickDestination(grid, { x: sim.x, z: sim.z }, rng, 3);
        c.sim = {
          ...sim, familiarity: fam, needs: { ...sim.needs, stress: Math.min(0.7, sim.needs.stress + 0.04) },
          activity: 'retreat', targetId: null, destX: dest.x, destZ: dest.z, activitySince: c.now, activityUntil: c.now + 75_000,
        };
        speak('pet_overstim', { streak: ps.streak });
        return `${catName} has had enough fuss for now and pads away.`;
      }
      const r = reactToPerson(sim, 'pet', c.relationship.familiarity);
      c.sim = { ...r.cat, familiarity: fam, prevActivity: sim.prevActivity };
      if (!r.accepted) {
        speak(r.mood === 'asleep' ? 'pet_asleep' : r.mood === 'wary' ? 'pet_wary' : 'pet_overstim', { streak: ps.streak });
        return reactionText(r.mood, catName);
      }
      speak('pet_ok', { streak: ps.streak });
      bumpRel('pet');
      await memory('first_pet', `${c.userName}'s first cuddle`, `${catName} leaned right into it.`);
      return `${catName} leans into your hand.`;
    }
    case 'treat': {
      await spend(c, 'treat', 'treats');
      const r = reactToPerson(sim, 'treat', c.relationship.familiarity);
      c.sim = { ...r.cat, prevActivity: sim.prevActivity };
      speak('treat');
      bumpRel('treat');
      return `${catName} crunches the treat happily.`;
    }
    case 'play': {
      const t = toy(c, a.toyId);
      if (!OBJECT_DEFS[t.type]?.tags.includes('toy')) throw new GameError(400, 'That isn\'t a toy.');
      if (t.location !== sim.location) throw new GameError(409, `${catName} is in the ${LOCATIONS[sim.location]?.label.toLowerCase() ?? 'other room'} right now.`);
      const r = reactToPerson(sim, 'play', c.relationship.familiarity);
      c.sim = { ...r.cat, prevActivity: sim.prevActivity };
      if (!r.accepted) { if (r.mood === 'tired') speak('play_tired'); return reactionText(r.mood, catName); }
      bumpRel('play');
      const chance = 0.5 + 0.45 * sim.personality.playfulness;
      if (rng() < chance) {
        const next = c.sim;
        next.activity = 'play';
        next.targetId = t.id;
        next.destX = null; next.destZ = null;
        next.activitySince = c.now;
        next.activityUntil = c.now + (3 + rng() * 4) * MINUTE;
        reinforce(next.preferences, `toy:${t.id}`, 0.05);
        familiarize(next.familiarity, t.id, 0.1);
        speak('play_go');
        await memory('first_play_with', `${c.userName} and ${catName} play together`, `A first proper game, ${catName} pouncing on the ${OBJECT_DEFS[t.type]!.label.toLowerCase()}.`);
        return `${catName} spots the ${OBJECT_DEFS[t.type]!.label.toLowerCase()} and crouches low...`;
      }
      speak('play_wait');
      return `${catName} watches the toy with interest, but isn't quite ready to pounce.`;
    }
    case 'call': {
      const loc = LOCATIONS[sim.location];
      if (!loc) throw new GameError(400, 'Unknown place.');
      const p = { x: Math.max(loc.bounds.minX + 0.3, Math.min(loc.bounds.maxX - 0.3, a.x)), z: Math.max(loc.bounds.minZ + 0.3, Math.min(loc.bounds.maxZ - 0.3, a.z)) };
      const asleep = !ACTIVITY_DEFS[sim.activity].awake;
      const distance = Math.hypot(sim.x - p.x, sim.z - p.z);
      if (!canHearCall(sim, distance)) { speak('call_unheard', { distance, x: p.x, z: p.z }); return `${catName} doesn't stir.`; }
      const chance = Math.max(0.08, Math.min(0.9,
        0.28 + 0.45 * sim.personality.sociability + 0.25 * c.relationship.familiarity - 0.25 * sim.personality.independence - (asleep ? 0.3 : 0) - sim.needs.stress * 0.3));
      if (rng() >= chance) { speak('call_ignored', { distance, x: p.x, z: p.z }); return `${catName} glances over, then carries on with her own plans.`; }
      const g = buildGrid(sim.location, c.objects);
      const cell = nearestFreeCell(g, p);
      const dest = cell ? cellCenter(g, cell.c, cell.r) : p;
      c.sim = { ...sim, activity: 'approach_person', targetId: null, destX: dest.x, destZ: dest.z, activitySince: c.now, activityUntil: c.now + 70_000 };
      speak('call_noticed', { distance, x: p.x, z: p.z });
      bumpRel('call');
      await memory('first_call', `${catName} comes when ${c.userName} calls`, 'Padded all the way over.');
      return `${catName} pads over to see what you're up to.`;
    }
    case 'move': {
      const o = toy(c, a.objectId);
      if (!o.movable) throw new GameError(409, `${defOf(o.type).label} is fixed in place.`);
      if (a.expectedVersion !== undefined && a.expectedVersion !== (c.versions.get(o.id) ?? 1)) {
        throw new GameError(409, 'Someone just moved that. The view has been refreshed.');
      }
      const def = defOf(o.type);
      const rot = def.blocks ? Math.round(a.rotation / (Math.PI / 2)) * (Math.PI / 2) : a.rotation;
      const cand: WorldObject = { ...o, x: Math.round(a.x * 10) / 10, z: Math.round(a.z * 10) / 10, rotation: rot };
      const check = validatePlacement(cand, c.objects, { x: sim.x, z: sim.z });
      if (!check.ok) throw new GameError(422, check.reason ?? 'It won\'t fit there.');
      Object.assign(o, { x: cand.x, z: cand.z, rotation: cand.rotation });
      noteNewObject(c.sim, o.id);
      if (sim.targetId === o.id) c.sim = { ...c.sim, activityUntil: c.now };
      return `${def.label} moved.`;
    }
  }
  // Unreachable for validated input; keeps the function total if the schema ever grows.
  throw new GameError(400, 'Unknown action.');
}

function reactionText(mood: string, name: string): string {
  switch (mood) {
    case 'asleep': return `${name} is fast asleep. Best not to wake her.`;
    case 'wary': return `${name} is feeling a little uneasy. Give her a quiet moment.`;
    case 'tired': return `${name} is too tired to play right now.`;
    default: return `${name} is happy on her own for the moment.`;
  }
}

async function saveRelationship(c: Ctx) {
  const r = c.relationship;
  await c.tx.update(s.catRelationships).set({
    familiarity: r.familiarity, recentPositive: r.recentPositive, interactionCounts: r.interactionCounts, lastInteractionAt: r.lastInteractionAt,
  }).where(and(eq(s.catRelationships.catId, r.catId), eq(s.catRelationships.userId, r.userId)));
  c.relDirty = false;
}

async function recordInteraction(c: Ctx, a: ActionInput) {
  const objectId = 'bowlId' in a ? a.bowlId : 'toyId' in a ? a.toyId : 'objectId' in a ? a.objectId : null;
  await c.tx.insert(s.interactionEvents).values({ householdId: c.householdId, userId: c.userId, kind: a.type, objectId, payload: {} });
  // Only the acting owner's own row is written, inside the household lock, so the other owner's history is never overwritten.
  await saveRelationship(c);
}

// Used by tests and scripts.
export const _internal = { mulberry32, inArray };
