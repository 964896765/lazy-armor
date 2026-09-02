ALTER TABLE `profiles`
  ADD COLUMN `preferences_json` json NULL AFTER `locale`;
