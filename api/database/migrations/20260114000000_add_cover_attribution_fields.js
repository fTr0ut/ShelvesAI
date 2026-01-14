/**
 * Migration: Add provider-agnostic cover art and attribution fields to collectables
 * 
 * - cover_image_url: Resolved image path (local or remote URL)
 * - cover_image_source: 'local' | 'external' - determines how to load the image
 * - attribution: JSONB with linkUrl, linkText, logoPath, disclaimerText
 */

exports.up = async function (knex) {
    await knex.schema.alterTable('collectables', (table) => {
        table.text('cover_image_url');
        table.text('cover_image_source');
        table.jsonb('attribution');
    });

    // Backfill existing collectables with local covers
    // Set cover_image_url from existing cover_media_path via media table
    await knex.raw(`
        UPDATE collectables c
        SET 
            cover_image_url = m.local_path,
            cover_image_source = 'local'
        FROM media m
        WHERE c.cover_media_id = m.id
          AND m.local_path IS NOT NULL
          AND c.cover_image_url IS NULL
    `);

    // For collectables without cached media, use cover_url as external
    await knex.raw(`
        UPDATE collectables
        SET 
            cover_image_url = cover_url,
            cover_image_source = 'external'
        WHERE cover_image_url IS NULL
          AND cover_url IS NOT NULL
    `);
};

exports.down = async function (knex) {
    await knex.schema.alterTable('collectables', (table) => {
        table.dropColumn('cover_image_url');
        table.dropColumn('cover_image_source');
        table.dropColumn('attribution');
    });
};
