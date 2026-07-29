-- Hidden developer flag (not a UI role). Only set via script/SQL.
ALTER TABLE users
  ADD COLUMN is_developer TINYINT(1) NOT NULL DEFAULT 0 AFTER role;
