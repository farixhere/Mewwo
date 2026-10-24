import { and, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema as s, type Tx } from './db';
import { stateColumns, toCatSim, toWorldObject } from './mappers';
import { hashInvite, newInviteCode } from './auth';
import { advance, noteNewObject, reactToPerson } from '../sim/engine';
import { ACTIVITY_DEFS } from '../sim/activities';
import { careHints, activityLabel, moodWord } from '../sim/describe';
import { ageDays, proportionsFor, stageForAge, stageLabel } from '../sim/growth';
import { defaultNeeds } from '../sim/needs';
import { describePersonality, rollPersonality } from '../sim/personality';
import { decisionRng, mulberry32, hashString } from '../sim/rng';
import { reinforce, familiarize } from '../sim/learning';
import { daylight, localHour } from '../sim/time';
import type { CatSim, SimEvent, WorldObject } from '../sim/types';
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
  const hid = await membershipOf(userId);
  if (!hid) throw new GameError(404, 'No household yet.');
  return getDb().transaction(async (tx) => {
    const [h] = await tx.select().from(s.households).where(eq(s.households.id, hid)).for('update');
    if (!h) throw new GameError(404, 'Household not found.');
    const now = Date.now();
    const [user] = await tx.select({ n: s.users.displayName }).from(s.users).where(eq(s.users.id, userId));
    const catRow = (await tx.select().from(s.cats).where(eq(s.cats.householdId, hid)).limit(1))[0]!;
    const st = (await tx.select().from(s.catState).where(eq(s.catState.catId, catRow.id)).limit(1))[0]!;
    const pers = (await tx.select().from(s.catPersonality).where(eq(s.catPersonality.catId, catRow.id)).limit(1))[0]!;
    const objRows = await tx.select().from(s.placedObjects).where(eq(s.placedObjects.householdId, hid));
    const invRows = await tx.select().from(s.inventoryItems).where(eq(s.inventoryItems.householdId, hid));
    const rel = (await tx.select().from(s.catRelationships).where(and(eq(s.catRelationships.catId, catRow.id), eq(s.catRelationships.userId, userId))).limit(1))[0]
      ?? (await tx.insert(s.catRelationships).values({ catId: catRow.id, userId }).returning())[0]!;
    const seen = (await tx.select({ t: max(s.householdMembers.lastSeenAt) }).from(s.householdMembers).where(eq(s.householdMembers.householdId, hid)))[0]?.t;
    const anyoneHere = !!seen && now - new Date(seen as unknown as string).getTime() < PRESENCE_MS;

    const ctx: Ctx = {
      tx, userId, userName: user?.n ?? 'Someone', householdId: hid, householdName: h.name, timeZone: h.timeZone, rev: Number(h.rev),
      catRow, sim: toCatSim(catRow, st, pers), objects: objRows.map(toWorldObject),
      versions: new Map(objRows.map((o) => [o.id, o.version])),
      inventory: new Map(invRows.map((i) => [i.itemType, { id: i.id, qty: i.quantity }])),
      relationship: rel, now, hour: localHour(now, h.timeZone), changed: false, events: [],
    };
    const originalObjects = new Map(ctx.objects.map((o) => [o.id, JSON.stringify([o.x, o.z, o.rotation, o.state])]));

    // 1. Growth may unlock the garden.
    await maybeUnlockGarden(ctx);
    // 2. Pantry refills slowly so nobody is ever stuck.
    await regenInventory(ctx, invRows);
    // 3. Bring the cat up to the present.
    const before = ctx.sim.rngCounter;
    const r = advance(ctx.sim, ctx.objects, now, { timeZone: h.timeZone, anyoneHere });
    ctx.sim = r.cat;
    ctx.objects = r.objects;
    ctx.events.push(...r.events);
    const decisionsMade = r.cat.rngCounter !== before;
    const objectsMoved = ctx.objects.some((o) => originalObjects.get(o.id) !== JSON.stringify([o.x, o.z, o.rotation, o.state]));
    const stale = now - st.lastSimAt.getTime() >= PERSIST_EVERY_MS;
    const mustPersist = opts.write || decisionsMade || objectsMoved || r.events.length > 0 || stale;

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
      occurredAt: new Date(e.at), dedupeKey: e.dedupeKey,
    }).onConflictDoNothing();
  }
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

export async function readState(userId: string) {
  return withHousehold(userId, (c) => buildView(c), { write: false });
}

async function buildView(c: Ctx) {
  const { tx, sim } = c;
  const members = await tx.select({ id: s.users.id, name: s.users.displayName, seen: s.householdMembers.lastSeenAt })
    .from(s.householdMembers).innerJoin(s.users, eq(s.users.id, s.householdMembers.userId))
    .where(eq(s.householdMembers.householdId, c.householdId));
  const mems = await tx.select().from(s.memories).where(eq(s.memories.householdId, c.householdId)).orderBy(desc(s.memories.occurredAt)).limit(60);
  const locs = await tx.select({ id: s.householdLocations.locationId }).from(s.householdLocations).where(eq(s.householdLocations.householdId, c.householdId));
  const rels = await tx.select().from(s.catRelationships).where(eq(s.catRelationships.catId, sim.id));
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
      traits: describePersonality(sim.personality),
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
      favourite: Object.entries(r.interactionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    })),
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
    c.relationship = {
      ...c.relationship,
      familiarity: Math.min(1, c.relationship.familiarity + 0.012),
      recentPositive: Math.min(1, c.relationship.recentPositive + 0.1),
      interactionCounts: { ...c.relationship.interactionCounts, [kind]: (c.relationship.interactionCounts[kind] ?? 0) + 1 },
      lastInteractionAt: new Date(c.now),
    };
  };
  const memory = async (kind: string, title: string, body?: string) => {
    c.events.push({ kind: kind as SimEvent['kind'], dedupeKey: `${kind}:${c.userId}`, title, body, at: c.now });
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
      const r = reactToPerson(sim, 'pet', c.relationship.familiarity);
      c.sim = { ...r.cat, prevActivity: sim.prevActivity };
      if (!r.accepted) return reactionText(r.mood, catName);
      bumpRel('pet');
      await memory('first_pet', `${c.userName}'s first cuddle`, `${catName} leaned right into it.`);
      return `${catName} purrs and leans into your hand.`;
    }
    case 'treat': {
      await spend(c, 'treat', 'treats');
      const r = reactToPerson(sim, 'treat', c.relationship.familiarity);
      c.sim = { ...r.cat, prevActivity: sim.prevActivity };
      bumpRel('treat');
      return `${catName} crunches the treat happily.`;
    }
    case 'play': {
      const t = toy(c, a.toyId);
      if (!OBJECT_DEFS[t.type]?.tags.includes('toy')) throw new GameError(400, 'That isn\'t a toy.');
      if (t.location !== sim.location) throw new GameError(409, `${catName} is in the ${LOCATIONS[sim.location]?.label.toLowerCase() ?? 'other room'} right now.`);
      const r = reactToPerson(sim, 'play', c.relationship.familiarity);
      c.sim = { ...r.cat, prevActivity: sim.prevActivity };
      if (!r.accepted) return reactionText(r.mood, catName);
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
        return `${catName} spots the ${OBJECT_DEFS[t.type]!.label.toLowerCase()} and crouches low...`;
      }
      return `${catName} watches the toy with interest, but isn't quite ready to pounce.`;
    }
    case 'call': {
      const loc = LOCATIONS[sim.location];
      if (!loc) throw new GameError(400, 'Unknown place.');
      const p = { x: Math.max(loc.bounds.minX + 0.3, Math.min(loc.bounds.maxX - 0.3, a.x)), z: Math.max(loc.bounds.minZ + 0.3, Math.min(loc.bounds.maxZ - 0.3, a.z)) };
      const asleep = !ACTIVITY_DEFS[sim.activity].awake;
      const chance = Math.max(0.08, Math.min(0.9,
        0.28 + 0.45 * sim.personality.sociability + 0.25 * c.relationship.familiarity - 0.25 * sim.personality.independence - (asleep ? 0.3 : 0) - sim.needs.stress * 0.3));
      if (rng() >= chance) return `${catName} glances over, then carries on with her own plans.`;
      const g = buildGrid(sim.location, c.objects);
      const cell = nearestFreeCell(g, p);
      const dest = cell ? cellCenter(g, cell.c, cell.r) : p;
      c.sim = { ...sim, activity: 'approach_person', targetId: null, destX: dest.x, destZ: dest.z, activitySince: c.now, activityUntil: c.now + 70_000 };
      bumpRel('call');
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

async function recordInteraction(c: Ctx, a: ActionInput) {
  const objectId = 'bowlId' in a ? a.bowlId : 'toyId' in a ? a.toyId : 'objectId' in a ? a.objectId : null;
  await c.tx.insert(s.interactionEvents).values({ householdId: c.householdId, userId: c.userId, kind: a.type, objectId, payload: {} });
  const r = c.relationship;
  await c.tx.update(s.catRelationships).set({
    familiarity: r.familiarity, recentPositive: r.recentPositive, interactionCounts: r.interactionCounts, lastInteractionAt: r.lastInteractionAt,
  }).where(and(eq(s.catRelationships.catId, r.catId), eq(s.catRelationships.userId, r.userId)));
}

// Used by tests and scripts.
export const _internal = { mulberry32, inArray };
