-- 1. The geog column
ALTER TABLE "StoreLocation"
  ADD COLUMN "geog" geography(Point, 4326);

ALTER TABLE "StoreAddress"
  ADD COLUMN "geog" geography(Point, 4326);

-- 2. Auto-populate on INSERT/UPDATE
CREATE OR REPLACE FUNCTION set_geog_from_latlng()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geog := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  ELSE
    NEW.geog := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER store_location_geog
BEFORE INSERT OR UPDATE OF latitude, longitude
ON "StoreLocation"
FOR EACH ROW EXECUTE FUNCTION set_geog_from_latlng();

CREATE TRIGGER store_address_geog
BEFORE INSERT OR UPDATE OF latitude, longitude
ON "StoreAddress"
FOR EACH ROW EXECUTE FUNCTION set_geog_from_latlng();

-- 3. Backfill existing rows
UPDATE "StoreLocation"
SET geog = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

UPDATE "StoreAddress"
SET geog = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- 4. GiST indexes
CREATE INDEX "StoreLocation_geog_idx" ON "StoreLocation" USING GIST (geog);
CREATE INDEX "StoreAddress_geog_idx"  ON "StoreAddress"  USING GIST (geog);

-- 5. (Optional but recommended) Denormalize the location onto Product
--    for the products query. See §5 below.