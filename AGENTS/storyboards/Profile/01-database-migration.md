# Task 01: Database Migration

## Objective
Extend the database schema to support profile features: bio field, profile photos, and wishlists.

## Changes

### 1. Add `bio` column to users table
```sql
ALTER TABLE users ADD COLUMN bio TEXT;
```

### 2. Create profile_media table
```sql
CREATE TABLE profile_media (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'avatar',
    source_url TEXT,
    local_path TEXT,
    content_type TEXT,
    size_bytes INTEGER,
    checksum TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_profile_media_user ON profile_media(user_id);
```

### 3. Add profile_media_id FK to users
```sql
ALTER TABLE users ADD COLUMN profile_media_id INTEGER REFERENCES profile_media(id) ON DELETE SET NULL;
```

### 4. Create wishlists table
```sql
CREATE TABLE wishlists (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT DEFAULT 'private' CHECK (visibility IN ('private', 'friends', 'public')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_wishlists_user ON wishlists(user_id);
CREATE INDEX idx_wishlists_visibility ON wishlists(visibility);
```

### 5. Create wishlist_items table
```sql
CREATE TABLE wishlist_items (
    id SERIAL PRIMARY KEY,
    wishlist_id INTEGER NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
    collectable_id INTEGER REFERENCES collectables(id) ON DELETE SET NULL,
    manual_text TEXT,
    notes TEXT,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT item_content_check CHECK (
        collectable_id IS NOT NULL OR manual_text IS NOT NULL
    )
);
CREATE INDEX idx_wishlist_items_wishlist ON wishlist_items(wishlist_id);
CREATE INDEX idx_wishlist_items_collectable ON wishlist_items(collectable_id) WHERE collectable_id IS NOT NULL;
```

### 6. Add trigger for updated_at
```sql
CREATE TRIGGER update_profile_media_updated_at
    BEFORE UPDATE ON profile_media
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wishlists_updated_at
    BEFORE UPDATE ON wishlists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

## Verification
- [ ] Migration runs without errors
- [ ] Can insert test data into new tables
- [ ] FK constraints work correctly
