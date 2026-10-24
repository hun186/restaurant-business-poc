-- v3: historical prices per location; recipe and dish prices in integer TWD cents.
CREATE TABLE ingredient_prices (
 id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
 location_id TEXT NOT NULL REFERENCES locations(id), price_date TEXT NOT NULL,
 price_cents INTEGER NOT NULL CHECK(price_cents>0 AND price_cents<=100000000000),
 unit TEXT NOT NULL,supplier TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL CHECK(source IN ('manual','receiving','direct_purchase')),
 reference_id TEXT,created_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ingredient_prices_effective ON ingredient_prices(location_id,ingredient_id,price_date DESC,created_at DESC);
CREATE TABLE menu_dishes (
 id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,
 sale_price_cents INTEGER NOT NULL CHECK(sale_price_cents>=0 AND sale_price_cents<=100000000000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dish_ingredients (
 id TEXT PRIMARY KEY,dish_id TEXT NOT NULL REFERENCES menu_dishes(id) ON DELETE CASCADE,
 ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
 qty REAL NOT NULL CHECK(qty>0),unit TEXT NOT NULL,UNIQUE(dish_id,ingredient_id)
);
CREATE INDEX idx_dish_ingredients_dish ON dish_ingredients(dish_id);
