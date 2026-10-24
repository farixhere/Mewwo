-- Mewwo initial schema. Server is authoritative; `version` columns give optimistic concurrency.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  time_zone text NOT NULL DEFAULT 'UTC',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household_members (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);
-- A user belongs to exactly one household in v1; a household holds at most two people.
CREATE UNIQUE INDEX household_members_user_uq ON household_members(user_id);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_by uuid REFERENCES users(id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_household_idx ON invitations(household_id);

CREATE TABLE cats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL UNIQUE REFERENCES households(id) ON DELETE CASCADE,
  name text NOT NULL,
  coat_seed int NOT NULL DEFAULT 1,
  born_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cat_personality (
  cat_id uuid PRIMARY KEY REFERENCES cats(id) ON DELETE CASCADE,
  curiosity real NOT NULL CHECK (curiosity BETWEEN 0 AND 1),
  playfulness real NOT NULL CHECK (playfulness BETWEEN 0 AND 1),
  sociability real NOT NULL CHECK (sociability BETWEEN 0 AND 1),
  cautiousness real NOT NULL CHECK (cautiousness BETWEEN 0 AND 1),
  independence real NOT NULL CHECK (independence BETWEEN 0 AND 1),
  activity real NOT NULL CHECK (activity BETWEEN 0 AND 1),
  -- learned preferences: { "toy:<objectId>": 0..1, "spot:<objectId>": 0..1 }
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cat_state (
  cat_id uuid PRIMARY KEY REFERENCES cats(id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1,
  last_sim_at timestamptz NOT NULL DEFAULT now(),
  -- needs, all 0..1 where 1 = fully met (hunger/thirst/etc. are stored as satisfaction)
  satiety real NOT NULL DEFAULT 0.8 CHECK (satiety BETWEEN 0 AND 1),
  hydration real NOT NULL DEFAULT 0.8 CHECK (hydration BETWEEN 0 AND 1),
  energy real NOT NULL DEFAULT 0.8 CHECK (energy BETWEEN 0 AND 1),
  comfort real NOT NULL DEFAULT 0.7 CHECK (comfort BETWEEN 0 AND 1),
  play real NOT NULL DEFAULT 0.5 CHECK (play BETWEEN 0 AND 1),
  curiosity_drive real NOT NULL DEFAULT 0.5 CHECK (curiosity_drive BETWEEN 0 AND 1),
  social real NOT NULL DEFAULT 0.5 CHECK (social BETWEEN 0 AND 1),
  stress real NOT NULL DEFAULT 0.1 CHECK (stress BETWEEN 0 AND 1),
  grooming real NOT NULL DEFAULT 0.7 CHECK (grooming BETWEEN 0 AND 1),
  elimination real NOT NULL DEFAULT 0.8 CHECK (elimination BETWEEN 0 AND 1),
  activity text NOT NULL DEFAULT 'idle',
  activity_target uuid,
  activity_since timestamptz NOT NULL DEFAULT now(),
  location_id text NOT NULL DEFAULT 'home',
  pos_x real NOT NULL DEFAULT 0,
  pos_z real NOT NULL DEFAULT 0,
  growth_stage text NOT NULL DEFAULT 'young_kitten'
    CHECK (growth_stage IN ('young_kitten','growing_kitten','adolescent','adult')),
  -- 0..1 growth is derived from born_at but cached for convenience
  growth real NOT NULL DEFAULT 0,
  -- familiarity with places/objects: { "<objectId>": 0..1 }
  familiarity jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cat_relationships (
  cat_id uuid NOT NULL REFERENCES cats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  familiarity real NOT NULL DEFAULT 0.1 CHECK (familiarity BETWEEN 0 AND 1),
  recent_positive real NOT NULL DEFAULT 0 CHECK (recent_positive BETWEEN 0 AND 1),
  -- counts per interaction type, e.g. {"pet":4,"play":2,"feed":9}
  interaction_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_interaction_at timestamptz,
  PRIMARY KEY (cat_id, user_id)
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  quantity int NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, item_type)
);

CREATE TABLE placed_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  location_id text NOT NULL DEFAULT 'home',
  object_type text NOT NULL,
  x real NOT NULL,
  z real NOT NULL,
  rotation real NOT NULL DEFAULT 0,
  movable boolean NOT NULL DEFAULT true,
  -- e.g. bowl contents: { "amount": 0..1 }
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX placed_objects_household_idx ON placed_objects(household_id, location_id);

CREATE TABLE household_locations (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  location_id text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, location_id)
);

CREATE TABLE interaction_events (
  id bigserial PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  object_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interaction_events_household_idx ON interaction_events(household_id, id DESC);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  object_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- prevents duplicate one-time milestones (e.g. first_meal)
  dedupe_key text,
  UNIQUE (household_id, dedupe_key)
);
CREATE INDEX memories_household_idx ON memories(household_id, occurred_at DESC);

CREATE TABLE sim_checkpoints (
  id bigserial PRIMARY KEY,
  cat_id uuid NOT NULL REFERENCES cats(id) ON DELETE CASCADE,
  from_at timestamptz NOT NULL,
  to_at timestamptz NOT NULL,
  steps int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sim_checkpoints_cat_idx ON sim_checkpoints(cat_id, id DESC);
