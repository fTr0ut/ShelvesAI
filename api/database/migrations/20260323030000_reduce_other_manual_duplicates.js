exports.up = async function (knex) {
    // Collapse duplicate manual links on the same shelf (keep earliest created row).
    await knex.raw(`
        WITH ranked AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY user_id, shelf_id, manual_id
                    ORDER BY created_at ASC NULLS LAST, id ASC
                ) AS rn
            FROM user_collections
            WHERE manual_id IS NOT NULL
        )
        DELETE FROM user_collections uc
        USING ranked r
        WHERE uc.id = r.id
          AND r.rn > 1
    `);

    // If ratings would collide after remap, keep the existing canonical rating and remove duplicate rows first.
    await knex.raw(`
        WITH manual_map AS (
            SELECT
                id AS duplicate_id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY user_id, shelf_id, manual_fingerprint
                    ORDER BY created_at ASC NULLS LAST, id ASC
                ) AS canonical_id
            FROM user_manuals
            WHERE manual_fingerprint IS NOT NULL
        )
        DELETE FROM user_ratings ur
        USING manual_map mm
        WHERE mm.duplicate_id <> mm.canonical_id
          AND ur.manual_id = mm.duplicate_id
          AND EXISTS (
              SELECT 1
              FROM user_ratings existing
              WHERE existing.user_id = ur.user_id
                AND existing.manual_id = mm.canonical_id
          )
    `);

    await knex.raw(`
        WITH manual_map AS (
            SELECT
                id AS duplicate_id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY user_id, shelf_id, manual_fingerprint
                    ORDER BY created_at ASC NULLS LAST, id ASC
                ) AS canonical_id
            FROM user_manuals
            WHERE manual_fingerprint IS NOT NULL
        )
        UPDATE user_ratings ur
        SET manual_id = mm.canonical_id
        FROM manual_map mm
        WHERE mm.duplicate_id <> mm.canonical_id
          AND ur.manual_id = mm.duplicate_id
    `);

    // If favorites would collide after remap, keep the existing canonical favorite and remove duplicate rows first.
    await knex.raw(`
        WITH manual_map AS (
            SELECT
                id AS duplicate_id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY user_id, shelf_id, manual_fingerprint
                    ORDER BY created_at ASC NULLS LAST, id ASC
                ) AS canonical_id
            FROM user_manuals
            WHERE manual_fingerprint IS NOT NULL
        )
        DELETE FROM user_favorites uf
        USING manual_map mm
        WHERE mm.duplicate_id <> mm.canonical_id
          AND uf.manual_id = mm.duplicate_id
          AND EXISTS (
              SELECT 1
              FROM user_favorites existing
              WHERE existing.user_id = uf.user_id
                AND existing.manual_id = mm.canonical_id
          )
    `);

    await knex.raw(`
        WITH manual_map AS (
            SELECT
                id AS duplicate_id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY user_id, shelf_id, manual_fingerprint
                    ORDER BY created_at ASC NULLS LAST, id ASC
                ) AS canonical_id
            FROM user_manuals
            WHERE manual_fingerprint IS NOT NULL
        )
        UPDATE user_favorites uf
        SET manual_id = mm.canonical_id
        FROM manual_map mm
        WHERE mm.duplicate_id <> mm.canonical_id
          AND uf.manual_id = mm.duplicate_id
    `);

    await knex.raw(`
        WITH manual_map AS (
            SELECT
                id AS duplicate_id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY user_id, shelf_id, manual_fingerprint
                    ORDER BY created_at ASC NULLS LAST, id ASC
                ) AS canonical_id
            FROM user_manuals
            WHERE manual_fingerprint IS NOT NULL
        )
        UPDATE event_aggregates ea
        SET manual_id = mm.canonical_id
        FROM manual_map mm
        WHERE mm.duplicate_id <> mm.canonical_id
          AND ea.manual_id = mm.duplicate_id
    `);

    await knex.raw(`
        WITH manual_map AS (
            SELECT
                id AS duplicate_id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY user_id, shelf_id, manual_fingerprint
                    ORDER BY created_at ASC NULLS LAST, id ASC
                ) AS canonical_id
            FROM user_manuals
            WHERE manual_fingerprint IS NOT NULL
        )
        UPDATE user_collections uc
        SET manual_id = mm.canonical_id
        FROM manual_map mm
        WHERE mm.duplicate_id <> mm.canonical_id
          AND uc.manual_id = mm.duplicate_id
    `);

    // After remap, collapse any duplicate manual links that now point to the same canonical manual.
    await knex.raw(`
        WITH ranked AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY user_id, shelf_id, manual_id
                    ORDER BY created_at ASC NULLS LAST, id ASC
                ) AS rn
            FROM user_collections
            WHERE manual_id IS NOT NULL
        )
        DELETE FROM user_collections uc
        USING ranked r
        WHERE uc.id = r.id
          AND r.rn > 1
    `);

    await knex.raw(`
        WITH manual_map AS (
            SELECT
                id AS duplicate_id,
                FIRST_VALUE(id) OVER (
                    PARTITION BY user_id, shelf_id, manual_fingerprint
                    ORDER BY created_at ASC NULLS LAST, id ASC
                ) AS canonical_id
            FROM user_manuals
            WHERE manual_fingerprint IS NOT NULL
        )
        DELETE FROM user_manuals um
        USING manual_map mm
        WHERE um.id = mm.duplicate_id
          AND mm.duplicate_id <> mm.canonical_id
    `);

    await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_collections_unique_manual
        ON user_collections(user_id, shelf_id, manual_id)
        WHERE manual_id IS NOT NULL
    `);

    await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_manuals_unique_fingerprint
        ON user_manuals(user_id, shelf_id, manual_fingerprint)
        WHERE manual_fingerprint IS NOT NULL
    `);
};

exports.down = async function (knex) {
    await knex.raw('DROP INDEX IF EXISTS idx_user_collections_unique_manual');
    await knex.raw('DROP INDEX IF EXISTS idx_user_manuals_unique_fingerprint');
};
