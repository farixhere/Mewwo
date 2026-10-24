import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, check, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

/** Typed mirror of db/migrations/*.sql. Keep the two in sync; the SQL files are what `db:migrate` applies. */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timeZone: text('time_zone').notNull().default('UTC'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  rev: bigint('rev', { mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const householdMembers = pgTable('household_members', {
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.householdId, t.userId] }), uniqueIndex('household_members_user_uq').on(t.userId)]);

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull().unique(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedBy: uuid('used_by').references(() => users.id),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('invitations_household_idx').on(t.householdId)]);

export const cats = pgTable('cats', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().unique().references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  coatSeed: integer('coat_seed').notNull().default(1),
  bornAt: timestamp('born_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const catPersonality = pgTable('cat_personality', {
  catId: uuid('cat_id').primaryKey().references(() => cats.id, { onDelete: 'cascade' }),
  curiosity: real('curiosity').notNull(),
  playfulness: real('playfulness').notNull(),
  sociability: real('sociability').notNull(),
  cautiousness: real('cautiousness').notNull(),
  independence: real('independence').notNull(),
  activity: real('activity').notNull(),
  preferences: jsonb('preferences').$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const catState = pgTable('cat_state', {
  catId: uuid('cat_id').primaryKey().references(() => cats.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  lastSimAt: timestamp('last_sim_at', { withTimezone: true }).notNull().defaultNow(),
  satiety: real('satiety').notNull().default(0.8),
  hydration: real('hydration').notNull().default(0.8),
  energy: real('energy').notNull().default(0.8),
  comfort: real('comfort').notNull().default(0.7),
  play: real('play').notNull().default(0.5),
  curiosityDrive: real('curiosity_drive').notNull().default(0.5),
  social: real('social').notNull().default(0.5),
  stress: real('stress').notNull().default(0.1),
  grooming: real('grooming').notNull().default(0.7),
  elimination: real('elimination').notNull().default(0.8),
  activity: text('activity').notNull().default('idle'),
  activityTarget: uuid('activity_target'),
  activitySince: timestamp('activity_since', { withTimezone: true }).notNull().defaultNow(),
  activityUntil: timestamp('activity_until', { withTimezone: true }).notNull().defaultNow(),
  rngCounter: integer('rng_counter').notNull().default(0),
  locationId: text('location_id').notNull().default('home'),
  posX: real('pos_x').notNull().default(0),
  posZ: real('pos_z').notNull().default(0),
  destX: real('dest_x'),
  destZ: real('dest_z'),
  growthStage: text('growth_stage').notNull().default('young_kitten'),
  growth: real('growth').notNull().default(0),
  familiarity: jsonb('familiarity').$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const catRelationships = pgTable('cat_relationships', {
  catId: uuid('cat_id').notNull().references(() => cats.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  familiarity: real('familiarity').notNull().default(0.1),
  recentPositive: real('recent_positive').notNull().default(0),
  interactionCounts: jsonb('interaction_counts').$type<Record<string, number>>().notNull().default({}),
  lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.catId, t.userId] })]);

export const inventoryItems = pgTable('inventory_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  itemType: text('item_type').notNull(),
  quantity: integer('quantity').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.householdId, t.itemType), check('inventory_qty_nonneg', sql`${t.quantity} >= 0`)]);

export const placedObjects = pgTable('placed_objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull().default('home'),
  objectType: text('object_type').notNull(),
  x: real('x').notNull(),
  z: real('z').notNull(),
  rotation: real('rotation').notNull().default(0),
  movable: boolean('movable').notNull().default(true),
  state: jsonb('state').$type<Record<string, number | string | boolean>>().notNull().default({}),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('placed_objects_household_idx').on(t.householdId, t.locationId)]);

export const householdLocations = pgTable('household_locations', {
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull(),
  unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.householdId, t.locationId] })]);

export const interactionEvents = pgTable('interaction_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  objectId: uuid('object_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  objectId: uuid('object_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  dedupeKey: text('dedupe_key'),
}, (t) => [unique().on(t.householdId, t.dedupeKey), index('memories_household_idx').on(t.householdId, t.occurredAt)]);

export const simCheckpoints = pgTable('sim_checkpoints', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  catId: uuid('cat_id').notNull().references(() => cats.id, { onDelete: 'cascade' }),
  fromAt: timestamp('from_at', { withTimezone: true }).notNull(),
  toAt: timestamp('to_at', { withTimezone: true }).notNull(),
  steps: integer('steps').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
