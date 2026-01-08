-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Fuzzy text search

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    
    -- Profile fields
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    picture TEXT,
    
    -- Location
    country TEXT,
    state TEXT,
    city TEXT,
    
    -- Privacy
    is_private BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;

-- ============================================
-- SHELVES
-- ============================================
CREATE TABLE shelves (
    id SERIAL PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    name TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'book', 'movie', 'game', 'music', etc.
    description TEXT,
    
    visibility TEXT DEFAULT 'private' 
        CHECK (visibility IN ('private', 'friends', 'public')),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shelves_owner ON shelves(owner_id);
CREATE INDEX idx_shelves_visibility ON shelves(visibility);
CREATE INDEX idx_shelves_type ON shelves(type);

-- ============================================
-- COLLECTABLES (Global Catalog)
-- ============================================
CREATE TABLE collectables (
    id SERIAL PRIMARY KEY,
    
    -- Fingerprints for deduplication
    fingerprint TEXT UNIQUE,
    lightweight_fingerprint TEXT,
    
    -- Core metadata
    kind TEXT NOT NULL,  -- 'book', 'movie', 'game', 'album'
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    
    -- Creators
    primary_creator TEXT,
    creators TEXT[] DEFAULT '{}',
    
    -- Publishing
    publishers TEXT[] DEFAULT '{}',
    year TEXT,
    
    -- Categorization
    tags TEXT[] DEFAULT '{}',
    
    -- External identifiers (ISBN, IMDB, IGDB, etc.)
    identifiers JSONB DEFAULT '{}',
    
    -- Images
    images JSONB DEFAULT '[]',
    cover_url TEXT,  -- Quick access to primary cover
    
    -- Source tracking
    sources JSONB DEFAULT '[]',
    external_id TEXT,  -- Primary external ID
    
    -- Fuzzy fingerprints for OCR matching
    fuzzy_fingerprints JSONB DEFAULT '[]',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_collectables_fingerprint ON collectables(fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX idx_collectables_lwf ON collectables(lightweight_fingerprint) WHERE lightweight_fingerprint IS NOT NULL;
CREATE INDEX idx_collectables_kind ON collectables(kind);
CREATE INDEX idx_collectables_title_trgm ON collectables USING GIN (title gin_trgm_ops);
CREATE INDEX idx_collectables_external_id ON collectables(external_id) WHERE external_id IS NOT NULL;

-- ============================================
-- USER MANUALS (Custom entries not in catalog)
-- ============================================
CREATE TABLE user_manuals (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
    
    name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    author TEXT,
    publisher TEXT,
    format TEXT,
    year TEXT,
    tags TEXT[] DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_manuals_user ON user_manuals(user_id);
CREATE INDEX idx_user_manuals_shelf ON user_manuals(shelf_id);

-- ============================================
-- USER COLLECTIONS (Items on shelves)
-- ============================================
CREATE TABLE user_collections (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
    
    -- Link to catalog OR manual entry (one must be set)
    collectable_id INTEGER REFERENCES collectables(id) ON DELETE SET NULL,
    manual_id INTEGER REFERENCES user_manuals(id) ON DELETE SET NULL,
    
    -- User-specific metadata
    position INTEGER,
    format TEXT,
    notes TEXT,
    rating DECIMAL(2,1) CHECK (rating >= 0 AND rating <= 5),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate items on same shelf
    UNIQUE(user_id, shelf_id, collectable_id),
    
    -- Ensure either collectable or manual is set
    CONSTRAINT item_reference_check CHECK (
        (collectable_id IS NOT NULL AND manual_id IS NULL) OR
        (collectable_id IS NULL AND manual_id IS NOT NULL)
    )
);

CREATE INDEX idx_user_collections_shelf ON user_collections(shelf_id);
CREATE INDEX idx_user_collections_user ON user_collections(user_id);
CREATE INDEX idx_user_collections_collectable ON user_collections(collectable_id) WHERE collectable_id IS NOT NULL;

-- ============================================
-- FRIENDSHIPS
-- ============================================
CREATE TABLE friendships (
    id SERIAL PRIMARY KEY,
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    status TEXT DEFAULT 'pending' 
        CHECK (status IN ('pending', 'accepted', 'blocked')),
    message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate friendships
    UNIQUE(requester_id, addressee_id),
    
    -- Prevent self-friendship
    CONSTRAINT no_self_friendship CHECK (requester_id != addressee_id)
);

CREATE INDEX idx_friendships_requester ON friendships(requester_id);
CREATE INDEX idx_friendships_addressee ON friendships(addressee_id);
CREATE INDEX idx_friendships_status ON friendships(status);

-- ============================================
-- EVENT LOGS (Activity feed)
-- ============================================
CREATE TABLE event_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    shelf_id INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
    
    event_type TEXT NOT NULL,
    payload JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_event_logs_user ON event_logs(user_id);
CREATE INDEX idx_event_logs_shelf ON event_logs(shelf_id);
CREATE INDEX idx_event_logs_type ON event_logs(event_type);
CREATE INDEX idx_event_logs_created ON event_logs(created_at DESC);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to tables with updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shelves_updated_at
    BEFORE UPDATE ON shelves
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_collectables_updated_at
    BEFORE UPDATE ON collectables
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friendships_updated_at
    BEFORE UPDATE ON friendships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
