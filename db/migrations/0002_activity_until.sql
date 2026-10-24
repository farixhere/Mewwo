-- The brain needs to know when the current activity is due to end.
ALTER TABLE cat_state ADD COLUMN activity_until timestamptz NOT NULL DEFAULT now();
ALTER TABLE cat_state ADD COLUMN rng_counter int NOT NULL DEFAULT 0;
