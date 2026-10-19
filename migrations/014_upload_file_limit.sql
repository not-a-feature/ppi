ALTER TABLE stored_file DROP CONSTRAINT stored_file_byte_count_check;
ALTER TABLE stored_file ADD CONSTRAINT stored_file_byte_count_check
  CHECK(byte_count BETWEEN 1 AND 31457280);
