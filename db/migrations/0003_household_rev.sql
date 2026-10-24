-- Monotonic revision per household. Every committed change bumps it; clients poll/subscribe on it.
ALTER TABLE households ADD COLUMN rev bigint NOT NULL DEFAULT 1;
