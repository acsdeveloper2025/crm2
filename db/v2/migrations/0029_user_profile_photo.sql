-- 0029_user_profile_photo.sql — profile-photo object key (User-Management parity epic, slice 7).
-- The photo bytes live in object storage (S3/MinIO, ADR-0021); the DB stores only the opaque key.
-- NULL = no photo. The key is server-minted (users/<id>/<uuid>); never user-supplied. Forward-only.

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_key text;
