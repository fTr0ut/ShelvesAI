-- ShelvesAI Database Schema
-- Generated from current production schema
-- Last updated: 2026-01-26

-- ============================================
-- EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Fuzzy text search

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,

    -- Profile fields
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    picture TEXT,
    bio TEXT,
    profile_media_id INTEGER,

    -- Location
    country TEXT,
    state TEXT,
    city TEXT,

    -- Flags
    is_private BOOLEAN DEFAULT FALSE,
    is_premium BOOLEAN DEFAULT FALSE,
    onboarding_completed BOOLEAN DEFAULT FALSE,

    -- Admin & Suspension
    is_admin BOOLEAN DEFAULT FALSE NOT NULL,
    is_suspended BOOLEAN DEFAULT FALSE NOT NULL,
    suspended_at TIMESTAMPTZ,
    suspension_reason TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;
CREATE INDEX idx_users_is_suspended ON users(is_suspended) WHERE is_suspended = true;

-- ============================================
-- PROFILE MEDIA (Avatar storage)
-- ============================================
CREATE TABLE profile_media (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(50) DEFAULT 'avatar' NOT NULL,
    source_url TEXT,
    local_path TEXT,
    content_type VARCHAR(100),
    size_bytes INTEGER,
    checksum VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_profile_media_user ON profile_media(user_id);

-- Add FK from users to profile_media (circular reference)
ALTER TABLE users
    ADD CONSTRAINT users_profile_media_id_fkey
    FOREIGN KEY (profile_media_id) REFERENCES profile_media(id) ON DELETE SET NULL;

-- ============================================
-- SHELVES
-- ============================================
CREATE TABLE shelves (
    id SERIAL PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'books', 'movies', 'games', 'vinyl', 'other'
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
    system_name TEXT,  -- e.g., "Nintendo 64", "PlayStation 2"
    formats JSONB DEFAULT '[]',
    format VARCHAR(20),  -- Legacy single format field

    -- Categorization
    tags TEXT[] DEFAULT '{}',
    genre TEXT[] DEFAULT '{}',
    runtime INTEGER,  -- minutes, primarily for film/TV

    -- External identifiers (ISBN, IMDB, IGDB, etc.)
    identifiers JSONB DEFAULT '{}',

    -- Images
    images JSONB DEFAULT '[]',
    cover_url TEXT,  -- Quick access to primary cover (legacy)
    cover_media_id INTEGER,
    cover_image_url TEXT,
    cover_image_source TEXT,  -- 'local' or 'external'
    attribution JSONB,  -- { linkUrl, linkText, logoPath, disclaimerText }

    -- Source tracking
    sources JSONB DEFAULT '[]',
    external_id TEXT,  -- Primary external ID
    editions_id INTEGER,  -- Link to editions table

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
CREATE INDEX idx_collectables_cover_media ON collectables(cover_media_id);

-- ============================================
-- EDITIONS (Collectables variants)
-- ============================================
CREATE TABLE editions (
    id SERIAL PRIMARY KEY,
    collectable_id INTEGER NOT NULL REFERENCES collectables(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    publisher TEXT,
    release_date DATE,
    format VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_editions_collectable_id ON editions(collectable_id);

-- ============================================
-- MEDIA (Cached images and binaries)
-- ============================================
CREATE TABLE media (
    id SERIAL PRIMARY KEY,
    collectable_id INTEGER NOT NULL REFERENCES collectables(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    variant TEXT,
    provider TEXT,
    source_url TEXT NOT NULL,
    local_path TEXT,
    content_type TEXT,
    size_bytes INTEGER,
    checksum TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_media_collectable ON media(collectable_id);
CREATE INDEX idx_media_kind ON media(kind);
CREATE UNIQUE INDEX idx_media_collectable_url ON media(collectable_id, source_url);

-- Add FK from collectables to media (circular reference)
ALTER TABLE collectables
    ADD CONSTRAINT collectables_cover_media_id_fkey
    FOREIGN KEY (cover_media_id) REFERENCES media(id) ON DELETE SET NULL;

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
    manufacturer VARCHAR(100),

    -- Extended metadata for "Other" shelf items
    age_statement TEXT,
    special_markings TEXT,
    label_color TEXT,
    regional_item TEXT,
    edition TEXT,
    barcode TEXT,
    manual_fingerprint TEXT,
    limited_edition TEXT,
    item_specific_text TEXT,

    -- Categorization
    genre TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_manuals_user ON user_manuals(user_id);
CREATE INDEX idx_user_manuals_shelf ON user_manuals(shelf_id);
CREATE INDEX idx_user_manuals_manual_fingerprint ON user_manuals(user_id, shelf_id, manual_fingerprint) WHERE manual_fingerprint IS NOT NULL;

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
-- USER RATINGS (Decoupled from collections)
-- ============================================
CREATE TABLE user_ratings (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collectable_id INTEGER REFERENCES collectables(id) ON DELETE CASCADE,
    manual_id INTEGER REFERENCES user_manuals(id) ON DELETE CASCADE,
    rating DECIMAL(2,1) CHECK (rating >= 0 AND rating <= 5),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure exactly one of collectable_id or manual_id is set
    CONSTRAINT item_reference_check CHECK (
        (collectable_id IS NOT NULL AND manual_id IS NULL) OR
        (collectable_id IS NULL AND manual_id IS NOT NULL)
    )
);

CREATE INDEX idx_user_ratings_user ON user_ratings(user_id);
CREATE INDEX idx_user_ratings_collectable ON user_ratings(collectable_id);
CREATE UNIQUE INDEX idx_user_ratings_manual ON user_ratings(user_id, manual_id) WHERE manual_id IS NOT NULL;
CREATE INDEX user_ratings_manual_id_index ON user_ratings(manual_id);

ALTER TABLE user_ratings
    ADD CONSTRAINT user_ratings_user_id_collectable_id_key UNIQUE (user_id, collectable_id);

-- ============================================
-- NEEDS REVIEW QUEUE
-- ============================================
CREATE TABLE needs_review (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,

    raw_data JSONB NOT NULL,
    confidence DECIMAL(3,2),
    status TEXT DEFAULT 'pending',  -- pending, completed, dismissed

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_needs_review_user_status ON needs_review(user_id, status);
CREATE INDEX idx_needs_review_shelf_status ON needs_review(shelf_id, status);

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
-- EVENT AGGREGATES (Activity feed batches)
-- ============================================
CREATE TABLE event_aggregates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    shelf_id INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
    collectable_id INTEGER REFERENCES collectables(id) ON DELETE SET NULL,
    manual_id INTEGER REFERENCES user_manuals(id) ON DELETE SET NULL,

    event_type TEXT NOT NULL,
    window_start_utc TIMESTAMPTZ NOT NULL,
    window_end_utc TIMESTAMPTZ NOT NULL,
    item_count INTEGER NOT NULL DEFAULT 0,
    preview_payloads JSONB NOT NULL DEFAULT '[]',

    -- Check-in specific fields
    checkin_status TEXT,  -- 'starting', 'continuing', 'completed'
    visibility TEXT DEFAULT 'public',  -- 'public', 'friends'
    note TEXT,

    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ
);

CREATE INDEX idx_event_aggregates_scope_window ON event_aggregates(user_id, shelf_id, event_type, window_end_utc);
CREATE INDEX idx_event_aggregates_last_activity ON event_aggregates(last_activity_at);
CREATE INDEX idx_event_aggregates_collectable ON event_aggregates(collectable_id);
CREATE INDEX idx_event_aggregates_manual ON event_aggregates(manual_id);

-- ============================================
-- EVENT LOGS (Activity feed items)
-- ============================================
CREATE TABLE event_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    shelf_id INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
    aggregate_id UUID REFERENCES event_aggregates(id) ON DELETE SET NULL,

    event_type TEXT NOT NULL,
    payload JSONB DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_event_logs_user ON event_logs(user_id);
CREATE INDEX idx_event_logs_shelf ON event_logs(shelf_id);
CREATE INDEX idx_event_logs_type ON event_logs(event_type);
CREATE INDEX idx_event_logs_aggregate ON event_logs(aggregate_id);
CREATE INDEX idx_event_logs_created ON event_logs(created_at DESC);

-- ============================================
-- EVENT SOCIAL (Likes + Comments)
-- ============================================
CREATE TABLE event_likes (
    id SERIAL PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES event_aggregates(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uniq_event_likes_event_user UNIQUE (event_id, user_id)
);

CREATE INDEX idx_event_likes_event ON event_likes(event_id);

CREATE TABLE event_comments (
    id SERIAL PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES event_aggregates(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_event_comments_event ON event_comments(event_id);
CREATE INDEX idx_event_comments_created ON event_comments(event_id, created_at);

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'friend_request', 'friend_accept')),
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('event', 'friendship')),
    metadata JSONB DEFAULT '{}' NOT NULL,
    is_read BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, created_at);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at);
CREATE UNIQUE INDEX idx_notifications_like_active ON notifications(user_id, actor_id, entity_id, type)
    WHERE type = 'like' AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_notifications_friend_request_dedup ON notifications(user_id, actor_id, entity_id, type)
    WHERE type = 'friend_request' AND deleted_at IS NULL;

-- ============================================
-- PUSH NOTIFICATIONS
-- ============================================
CREATE TABLE push_device_tokens (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expo_push_token TEXT NOT NULL,
    device_id TEXT,
    platform TEXT,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_used_at TIMESTAMPTZ,
    CONSTRAINT push_device_tokens_user_id_expo_push_token_unique UNIQUE (user_id, expo_push_token)
);

CREATE INDEX idx_push_tokens_user_active ON push_device_tokens(user_id, is_active);
CREATE INDEX idx_push_tokens_token ON push_device_tokens(expo_push_token);

CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    push_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    push_likes BOOLEAN DEFAULT TRUE NOT NULL,
    push_comments BOOLEAN DEFAULT TRUE NOT NULL,
    push_friend_requests BOOLEAN DEFAULT TRUE NOT NULL,
    push_friend_accepts BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================
-- PASSWORD RESET
-- ============================================
CREATE TABLE password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);

-- ============================================
-- VISION QUOTA
-- ============================================
CREATE TABLE user_vision_quota (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    scans_used INTEGER DEFAULT 0 NOT NULL,
    period_start TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ============================================
-- ADMIN ACTION LOGS
-- ============================================
CREATE TABLE admin_action_logs (
    id SERIAL PRIMARY KEY,
    admin_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    target_user_id UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}' NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_action_logs_admin_id ON admin_action_logs(admin_id);
CREATE INDEX idx_admin_action_logs_target_user_id ON admin_action_logs(target_user_id);
CREATE INDEX idx_admin_action_logs_action ON admin_action_logs(action);
CREATE INDEX idx_admin_action_logs_created_at ON admin_action_logs(created_at);

-- ============================================
-- NEWS ITEMS (Trending/Upcoming from APIs)
-- ============================================
CREATE TABLE news_items (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,  -- 'movies', 'tv', 'games', 'books', 'vinyl'
    item_type TEXT NOT NULL,  -- 'trending', 'upcoming', 'now_playing', 'recent', 'news', 'editorial'
    title TEXT NOT NULL,
    description TEXT,
    cover_image_url TEXT,
    release_date DATE,
    physical_release_date DATE,
    creators TEXT[] DEFAULT '{}',
    franchises TEXT[] DEFAULT '{}',
    genres TEXT[] DEFAULT '{}',
    external_id TEXT,
    source_api TEXT,
    source_url TEXT,
    payload JSONB DEFAULT '{}',
    collectable_id INTEGER REFERENCES collectables(id) ON DELETE SET NULL,
    votes INTEGER DEFAULT 0 NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_news_items_category ON news_items(category);
CREATE INDEX idx_news_items_item_type ON news_items(item_type);
CREATE INDEX idx_news_items_release_date ON news_items(release_date);
CREATE INDEX idx_news_items_expires_at ON news_items(expires_at);
CREATE INDEX idx_news_items_creators ON news_items USING GIN (creators);
CREATE INDEX idx_news_items_genres ON news_items USING GIN (genres);
CREATE INDEX idx_news_items_collectable_id ON news_items(collectable_id);
CREATE UNIQUE INDEX idx_news_items_unique ON news_items(source_api, external_id, item_type);

-- ============================================
-- USER NEWS TRACKING
-- ============================================
CREATE TABLE user_news_seen (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    news_item_id INTEGER NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_news_seen_user_id_news_item_id_unique UNIQUE (user_id, news_item_id)
);

CREATE INDEX idx_user_news_seen_user ON user_news_seen(user_id);

CREATE TABLE user_news_dismissed (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    news_item_id INTEGER NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_news_dismissed_user_id_news_item_id_unique UNIQUE (user_id, news_item_id)
);

CREATE INDEX idx_user_news_dismissed_user ON user_news_dismissed(user_id);

-- ============================================
-- USER FAVORITES (Items user loves)
-- ============================================
CREATE TABLE user_favorites (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collectable_id INTEGER NOT NULL REFERENCES collectables(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, collectable_id)
);

CREATE INDEX idx_user_favorites_user ON user_favorites(user_id);
CREATE INDEX idx_user_favorites_collectable ON user_favorites(collectable_id);

-- ============================================
-- USER LISTS (Custom collections like "Top 10 Horror Movies")
-- ============================================
CREATE TABLE user_lists (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT DEFAULT 'private'
        CHECK (visibility IN ('private', 'friends', 'public')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_lists_user ON user_lists(user_id);

CREATE TABLE user_list_items (
    id SERIAL PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
    collectable_id INTEGER NOT NULL REFERENCES collectables(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 1 AND position <= 10),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(list_id, collectable_id),
    UNIQUE(list_id, position)
);

CREATE INDEX idx_user_list_items_list ON user_list_items(list_id);

-- ============================================
-- WISHLISTS
-- ============================================
CREATE TABLE wishlists (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    visibility VARCHAR(20) DEFAULT 'private',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wishlists_user ON wishlists(user_id);
CREATE INDEX idx_wishlists_visibility ON wishlists(visibility);

CREATE TABLE wishlist_items (
    id SERIAL PRIMARY KEY,
    wishlist_id INTEGER NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
    collectable_id INTEGER REFERENCES collectables(id) ON DELETE SET NULL,
    manual_text TEXT,
    notes TEXT,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wishlist_items_wishlist ON wishlist_items(wishlist_id);
CREATE INDEX idx_wishlist_items_collectable ON wishlist_items(collectable_id);

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

CREATE TRIGGER update_media_updated_at
    BEFORE UPDATE ON media
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friendships_updated_at
    BEFORE UPDATE ON friendships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_lists_updated_at
    BEFORE UPDATE ON user_lists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_ratings_updated_at
    BEFORE UPDATE ON user_ratings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
