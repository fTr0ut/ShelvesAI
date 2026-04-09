const {
  buildScoutPrompt,
  buildMultiRegionScoutPrompt,
  parseScoutResponse,
  parseMultiRegionScoutResponse,
} = require('../services/visionScout');

describe('visionScout', () => {
  describe('buildScoutPrompt', () => {
    it('embeds the shelf type in the prompt', () => {
      const prompt = buildScoutPrompt('books');
      expect(prompt).toContain('books shelf photo');
      expect(prompt).toContain('region_box_2d');
    });

    it('defaults to "items" for empty shelf type', () => {
      expect(buildScoutPrompt('')).toContain('items shelf photo');
      expect(buildScoutPrompt(null)).toContain('items shelf photo');
    });
  });

  describe('buildMultiRegionScoutPrompt', () => {
    it('embeds the shelf type and requests regions array', () => {
      const prompt = buildMultiRegionScoutPrompt('vinyl');
      expect(prompt).toContain('vinyl shelf photo');
      expect(prompt).toContain('"regions"');
    });
  });

  describe('parseScoutResponse', () => {
    it('parses a well-formed single-region response', () => {
      const input = JSON.stringify({
        region_box_2d: [50, 30, 950, 970],
        confidence: 0.88,
        estimated_item_count: 7,
        has_more_than_ten: false,
        full_image_estimated_item_count: 7,
        full_image_has_more_than_ten: false,
      });

      const result = parseScoutResponse(input);
      expect(result.regionBox2d).toEqual([50, 30, 950, 970]);
      expect(result.confidence).toBeCloseTo(0.88);
      expect(result.estimatedItemCount).toBe(7);
      expect(result.hasMoreThanTen).toBe(false);
      expect(result.fullImageEstimatedItemCount).toBe(7);
      expect(result.fullImageHasMoreThanTen).toBe(false);
    });

    it('handles markdown-fenced JSON', () => {
      const input = '```json\n{"region_box_2d":[100,200,800,900],"confidence":0.9,"estimated_item_count":15,"has_more_than_ten":true,"full_image_estimated_item_count":15,"full_image_has_more_than_ten":true}\n```';
      const result = parseScoutResponse(input);
      expect(result.estimatedItemCount).toBe(15);
      expect(result.hasMoreThanTen).toBe(true);
    });

    it('derives hasMoreThanTen from count rather than trusting the field', () => {
      const input = JSON.stringify({
        region_box_2d: [0, 0, 1000, 1000],
        confidence: 0.7,
        estimated_item_count: 5,
        has_more_than_ten: true,
        full_image_estimated_item_count: 5,
        full_image_has_more_than_ten: true,
      });
      const result = parseScoutResponse(input);
      expect(result.hasMoreThanTen).toBe(false);
      expect(result.fullImageHasMoreThanTen).toBe(false);
    });

    it('accepts null region_box_2d', () => {
      const input = JSON.stringify({
        region_box_2d: null,
        confidence: 0,
        estimated_item_count: 0,
        has_more_than_ten: false,
        full_image_estimated_item_count: 0,
        full_image_has_more_than_ten: false,
      });
      const result = parseScoutResponse(input);
      expect(result.regionBox2d).toBeNull();
    });

    it('throws on missing required counts', () => {
      const input = JSON.stringify({
        region_box_2d: [0, 0, 1000, 1000],
        confidence: 0.5,
      });
      expect(() => parseScoutResponse(input)).toThrow(/estimated_item_count/);
    });

    it('throws on non-JSON text', () => {
      expect(() => parseScoutResponse('This is not JSON at all.')).toThrow();
    });

    it('accepts camelCase field names', () => {
      const input = JSON.stringify({
        regionBox2d: [100, 200, 800, 900],
        confidence: 0.75,
        estimatedItemCount: 12,
        hasMoreThanTen: true,
        fullImageEstimatedItemCount: 12,
        fullImageHasMoreThanTen: true,
      });
      const result = parseScoutResponse(input);
      expect(result.estimatedItemCount).toBe(12);
      expect(result.fullImageEstimatedItemCount).toBe(12);
    });
  });

  describe('parseMultiRegionScoutResponse', () => {
    it('parses a well-formed multi-region response', () => {
      const input = JSON.stringify({
        full_image_estimated_item_count: 25,
        full_image_has_more_than_ten: true,
        regions: [
          { region_box_2d: [0, 0, 400, 1000], confidence: 0.9, estimated_item_count: 12, has_more_than_ten: true },
          { region_box_2d: [450, 0, 1000, 1000], confidence: 0.85, estimated_item_count: 13, has_more_than_ten: true },
        ],
      });

      const result = parseMultiRegionScoutResponse(input);
      expect(result.fullImageEstimatedItemCount).toBe(25);
      expect(result.fullImageHasMoreThanTen).toBe(true);
      expect(result.regions).toHaveLength(2);
      expect(result.estimatedItemCount).toBe(25); // sum of per-region counts
      expect(result.hasMoreThanTen).toBe(true);
    });

    it('filters out invalid regions', () => {
      const input = JSON.stringify({
        full_image_estimated_item_count: 5,
        full_image_has_more_than_ten: false,
        regions: [
          { region_box_2d: [0, 0, 500, 1000], confidence: 0.9, estimated_item_count: 5, has_more_than_ten: false },
          { region_box_2d: 'invalid', confidence: 0.5, estimated_item_count: 2 },
          null,
        ],
      });

      const result = parseMultiRegionScoutResponse(input);
      expect(result.regions).toHaveLength(1);
    });

    it('throws on missing full_image_estimated_item_count', () => {
      const input = JSON.stringify({
        regions: [{ region_box_2d: [0, 0, 1000, 1000], confidence: 0.9, estimated_item_count: 5 }],
      });
      expect(() => parseMultiRegionScoutResponse(input)).toThrow(/full_image_estimated_item_count/);
    });

    it('throws on missing regions array', () => {
      const input = JSON.stringify({
        full_image_estimated_item_count: 5,
        full_image_has_more_than_ten: false,
      });
      expect(() => parseMultiRegionScoutResponse(input)).toThrow(/regions array/);
    });

    it('returns empty regions with zero counts', () => {
      const input = JSON.stringify({
        full_image_estimated_item_count: 0,
        full_image_has_more_than_ten: false,
        regions: [],
      });
      const result = parseMultiRegionScoutResponse(input);
      expect(result.regions).toHaveLength(0);
      expect(result.estimatedItemCount).toBe(0);
      expect(result.hasMoreThanTen).toBe(false);
    });
  });
});
