-- J1: everybody signs in with a username + password. `username` is lower-case (3–30 chars of a-z 0-9 . _ -, starting with a letter or digit) and unique.
-- Backfill: staff / admin → the part of the e-mail before the @ (-2, -3 … when it clashes); everyone else → 'u' + the digits of the phone (u966500000001).
-- The column stays nullable (a few internal tools insert users without one); a user without a username can still sign in with an e-mail address when they have one.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;--> statement-breakpoint
DO $$
DECLARE
  r record;
  base text;
  cand text;
  n integer;
BEGIN
  FOR r IN SELECT id, role, email, phone FROM users WHERE username IS NULL ORDER BY created_at, id LOOP
    IF r.role IN ('staff', 'admin') AND r.email IS NOT NULL THEN
      base := regexp_replace(lower(split_part(r.email, '@', 1)), '[^a-z0-9._-]', '', 'g');
      base := regexp_replace(base, '^[._-]+', '');
      IF length(base) < 3 THEN base := base || 'user'; END IF;
      base := left(base, 26);
    ELSIF r.phone IS NOT NULL AND length(regexp_replace(r.phone, '\D', '', 'g')) >= 2 THEN
      base := left('u' || regexp_replace(r.phone, '\D', '', 'g'), 26);
    ELSE
      base := 'u' || left(replace(r.id::text, '-', ''), 12);
    END IF;
    cand := base; n := 1;
    WHILE EXISTS (SELECT 1 FROM users WHERE username = cand) LOOP
      n := n + 1; cand := base || '-' || n;
    END LOOP;
    UPDATE users SET username = cand WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE ("username");
