-- Additive defaults preserve all existing Arabic queues and public listings.
-- Deploy only with the matching application; no existing IDs/history is reset.
ALTER TABLE mafia_ranked_queue ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'ar' CHECK(content_locale IN ('ar','en'));
ALTER TABLE online_public_rooms ADD COLUMN content_locale TEXT NOT NULL DEFAULT 'ar' CHECK(content_locale IN ('ar','en'));
ALTER TABLE online_public_rooms ADD COLUMN content_version TEXT NOT NULL DEFAULT 'legacy-ar';
