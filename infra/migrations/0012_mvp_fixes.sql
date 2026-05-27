-- 0012: Alter subscription_state to add 'pending' and add heartbeat_count to watch_sessions.
ALTER TYPE subscription_state ADD VALUE 'pending';
ALTER TABLE watch_sessions ADD COLUMN heartbeat_count integer NOT NULL DEFAULT 0;
