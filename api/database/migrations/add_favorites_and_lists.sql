-- Migration: Add user personalization tables
-- Run this to add favorites and lists support
-- Date: 2026-01-13

-- ============================================
-- HELPER FUNCTION (create if not exists)
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================
-- USER FAVORITES (Items user loves)
-- ============================================
CREATE TABLE IF NOT EXISTS user_favorites (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collectable_id INTEGER NOT NULL REFERENCES collectables(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, collectable_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_collectable ON user_favorites(collectable_id);

-- ============================================
-- USER LISTS (Custom collections like "Top 10 Horror Movies")
-- ============================================
CREATE TABLE IF NOT EXISTS user_lists (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT DEFAULT 'private' 
        CHECK (visibility IN ('private', 'friends', 'public')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_lists_user ON user_lists(user_id);

CREATE TABLE IF NOT EXISTS user_list_items (
    id SERIAL PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
    collectable_id INTEGER NOT NULL REFERENCES collectables(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 1 AND position <= 10),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(list_id, collectable_id),
    UNIQUE(list_id, position)
);

CREATE INDEX IF NOT EXISTS idx_user_list_items_list ON user_list_items(list_id);

-- Add trigger for user_lists updated_at
DROP TRIGGER IF EXISTS update_user_lists_updated_at ON user_lists;
CREATE TRIGGER update_user_lists_updated_at
    BEFORE UPDATE ON user_lists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Verify tables created
SELECT 'Migration complete! Tables created:' as status;
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('user_favorites', 'user_lists', 'user_list_items');
