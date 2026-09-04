ALTER TABLE trusted_device_challenges
  ADD COLUMN public_key_spki TEXT NOT NULL AFTER key_id;
