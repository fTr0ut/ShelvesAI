const { query } = require('../../database/pg');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRatio(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_GROUP_LIMIT = parsePositiveInt(process.env.NEWS_FEED_GROUP_LIMIT, 3);
const DEFAULT_ITEMS_PER_GROUP = parsePositiveInt(process.env.NEWS_FEED_ITEMS_PER_GROUP, 3);
const DEFAULT_MIN_MOVIES_FOR_FORMAT = parsePositiveInt(process.env.NEWS_FEED_MIN_MOVIES_FOR_FORMAT, 10);
const DEFAULT_MIN_FORMAT_COUNT = parsePositiveInt(process.env.NEWS_FEED_MIN_4K_COUNT, 3);
const DEFAULT_MIN_FORMAT_RATIO = parseRatio(process.env.NEWS_FEED_MIN_4K_RATIO, 0.15);

const FOUR_K_ITEM_TYPES = ['preorder_4k', 'new_release_4k', 'upcoming_4k'];
const FOUR_K_FORMATS = ['4k', '4k uhd', 'uhd', '4k uhd blu-ray'];

function getItemTypePlaceholders(itemTypes, startIndex) {
  return itemTypes.map((_, idx) => `$${startIndex + idx}`).join(', ');
}

async function getNewsRecommendationsForUser(userId, options = {}) {
  if (!userId) return [];

  const groupLimit = parsePositiveInt(options.groupLimit, DEFAULT_GROUP_LIMIT);
  const itemsPerGroup = parsePositiveInt(options.itemsPerGroup, DEFAULT_ITEMS_PER_GROUP);
  if (groupLimit <= 0 || itemsPerGroup <= 0) return [];

  const minMoviesForFormat = parsePositiveInt(
    options.minMoviesForFormat,
    DEFAULT_MIN_MOVIES_FOR_FORMAT,
  );
  const minFormatCount = parsePositiveInt(options.minFormatCount, DEFAULT_MIN_FORMAT_COUNT);
  const minFormatRatio = parseRatio(options.minFormatRatio, DEFAULT_MIN_FORMAT_RATIO);

  const itemTypeStartIndex = 8;
  const itemTypePlaceholders = getItemTypePlaceholders(FOUR_K_ITEM_TYPES, itemTypeStartIndex);

  const sql = `
    WITH user_items AS (
      SELECT
        uc.user_id,
        s.type AS category,
        c.primary_creator,
        c.creators,
        c.genre,
        c.tags,
        c.formats,
        uc.format AS user_format,
        NULL::text AS manual_format
      FROM user_collections uc
      JOIN shelves s ON s.id = uc.shelf_id
      LEFT JOIN collectables c ON c.id = uc.collectable_id
      WHERE uc.user_id = $1

      UNION ALL

      SELECT
        uc.user_id,
        s.type AS category,
        um.author AS primary_creator,
        NULL::text[] AS creators,
        um.genre,
        um.tags,
        NULL::jsonb AS formats,
        uc.format AS user_format,
        um.format AS manual_format
      FROM user_collections uc
      JOIN shelves s ON s.id = uc.shelf_id
      JOIN user_manuals um ON um.id = uc.manual_id
      WHERE uc.user_id = $1
    ),
    creator_set AS (
      SELECT DISTINCT unnest(
        array_remove(array_cat(coalesce(creators, '{}'), ARRAY[primary_creator]), NULL)
      ) AS creator
      FROM user_items
    ),
    genre_set AS (
      SELECT DISTINCT unnest(coalesce(genre, '{}')) AS genre
      FROM user_items
      UNION
      SELECT DISTINCT unnest(coalesce(tags, '{}')) AS genre
      FROM user_items
    ),
    format_raw AS (
      SELECT lower(value) AS format
      FROM user_items
      CROSS JOIN LATERAL (
        SELECT NULLIF(user_format, '') AS value
        UNION ALL
        SELECT NULLIF(manual_format, '')
        UNION ALL
        SELECT jsonb_array_elements_text(coalesce(formats, '[]'::jsonb))
      ) f
      WHERE value IS NOT NULL AND btrim(value) <> ''
    ),
    format_counts AS (
      SELECT format, COUNT(*)::int AS count
      FROM format_raw
      GROUP BY format
    ),
    profile AS (
      SELECT
        (SELECT array_agg(category)
         FROM (SELECT DISTINCT category FROM user_items WHERE category IS NOT NULL) c) AS categories,
        (SELECT array_agg(creator) FROM creator_set) AS creators,
        (SELECT array_agg(genre) FROM genre_set) AS genres,
        (SELECT array_agg(DISTINCT format) FROM format_raw) AS formats,
        (SELECT COUNT(*)
         FROM user_collections uc
         JOIN shelves s ON s.id = uc.shelf_id
         WHERE uc.user_id = $1 AND s.type = 'movies') AS movie_count,
        COALESCE(
          (SELECT count FROM format_counts WHERE format = ANY($4)),
          0
        ) AS format_4k_count
    ),
    seen_external_ids AS (
      SELECT DISTINCT c.external_id
      FROM user_collections uc
      JOIN collectables c ON c.id = uc.collectable_id
      WHERE uc.user_id = $1 AND c.external_id IS NOT NULL
    ),
    candidates AS (
      SELECT
        ni.id,
        ni.category,
        ni.item_type,
        ni.title,
        ni.description,
        ni.cover_image_url,
        ni.release_date,
        ni.physical_release_date,
        ni.creators,
        ni.genres,
        ni.external_id,
        ni.source_api,
        ni.source_url,
        ni.payload,
        ni.fetched_at,
        c.id AS collectable_id,
        c.kind AS collectable_kind,
        c.primary_creator AS collectable_primary_creator,
        CASE WHEN ni.category = ANY(coalesce(profile.categories, '{}'::text[])) THEN 2 ELSE 0 END +
        CASE WHEN ni.creators && coalesce(profile.creators, '{}'::text[]) THEN 3 ELSE 0 END +
        CASE WHEN ni.genres && coalesce(profile.genres, '{}'::text[]) THEN 1 ELSE 0 END
        AS relevance_score,
        array_remove(ARRAY[
          CASE WHEN ni.category = ANY(coalesce(profile.categories, '{}'::text[])) THEN 'category' END,
          CASE WHEN ni.creators && coalesce(profile.creators, '{}'::text[]) THEN 'creator' END,
          CASE WHEN ni.genres && coalesce(profile.genres, '{}'::text[]) THEN 'genre' END,
          CASE WHEN ni.item_type IN (${itemTypePlaceholders}) THEN 'format:4k' END
        ], NULL) AS reasons
      FROM news_items ni
      LEFT JOIN collectables c ON c.id = ni.collectable_id
      CROSS JOIN profile
      WHERE ni.expires_at > NOW()
        AND (
          profile.categories IS NULL
          OR array_length(profile.categories, 1) IS NULL
          OR ni.category = ANY(profile.categories)
        )
        AND (
          ni.external_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM seen_external_ids s WHERE s.external_id = ni.external_id
          )
        )
        AND (
          ni.item_type NOT IN (${itemTypePlaceholders})
          OR (
            profile.movie_count >= $2
            AND profile.format_4k_count >= $3
            AND (profile.format_4k_count::float / NULLIF(profile.movie_count, 0)) >= $7
          )
        )
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY category, item_type
          ORDER BY relevance_score DESC,
                   COALESCE(physical_release_date, release_date) DESC NULLS LAST,
                   (payload->>'popularity')::float DESC NULLS LAST
        ) AS rn
      FROM candidates
    ),
    groups AS (
      SELECT
        category,
        item_type,
        MAX(relevance_score) AS max_score,
        MAX(COALESCE(physical_release_date, release_date, fetched_at)) AS latest_date
      FROM ranked
      WHERE rn <= $5
      GROUP BY category, item_type
    ),
    ranked_groups AS (
      SELECT *,
        ROW_NUMBER() OVER (
          ORDER BY max_score DESC, latest_date DESC, category, item_type
        ) AS group_rank
      FROM groups
    ),
    final AS (
      SELECT
        r.*,
        g.group_rank,
        g.max_score,
        g.latest_date
      FROM ranked r
      JOIN ranked_groups g
        ON g.category = r.category AND g.item_type = r.item_type
      WHERE r.rn <= $5 AND g.group_rank <= $6
    )
    SELECT * FROM final
    ORDER BY group_rank, relevance_score DESC, COALESCE(physical_release_date, release_date) DESC NULLS LAST;
  `;

  const params = [
    userId,
    minMoviesForFormat,
    minFormatCount,
    FOUR_K_FORMATS,
    itemsPerGroup,
    groupLimit,
    minFormatRatio,
    ...FOUR_K_ITEM_TYPES,
  ];

  const result = await query(sql, params);
  if (!result.rows.length) return [];

  const groups = new Map();
  for (const row of result.rows) {
    const key = `${row.category}:${row.item_type}`;
    const existing = groups.get(key);
    const latestDate = row.latest_date || row.physical_release_date || row.release_date || row.fetched_at;
    const group = existing || {
      key,
      category: row.category,
      itemType: row.item_type,
      groupRank: row.group_rank,
      maxScore: row.max_score,
      latestDate,
      items: [],
    };

    group.items.push({
      id: row.id,
      category: row.category,
      itemType: row.item_type,
      title: row.title,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      releaseDate: row.release_date,
      physicalReleaseDate: row.physical_release_date,
      creators: row.creators || [],
      genres: row.genres || [],
      externalId: row.external_id,
      sourceApi: row.source_api,
      sourceUrl: row.source_url,
      payload: row.payload || {},
      relevanceScore: row.relevance_score,
      reasons: Array.isArray(row.reasons) ? row.reasons : [],
      collectableId: row.collectable_id || null,
      collectableKind: row.collectable_kind || null,
      collectablePrimaryCreator: row.collectable_primary_creator || null,
    });

    if (!existing) {
      groups.set(key, group);
      continue;
    }

    const currentDate = group.latestDate ? new Date(group.latestDate) : null;
    const nextDate = latestDate ? new Date(latestDate) : null;
    if (nextDate && (!currentDate || nextDate > currentDate)) {
      group.latestDate = latestDate;
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.groupRank - b.groupRank);
}

module.exports = {
  getNewsRecommendationsForUser,
};
