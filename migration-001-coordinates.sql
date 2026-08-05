-- Apply once to an existing local or remote D1 database.
ALTER TABLE extracted_items ADD COLUMN latitude REAL;
ALTER TABLE extracted_items ADD COLUMN longitude REAL;
