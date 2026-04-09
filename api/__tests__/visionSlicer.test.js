const {
  computeSliceRects,
  extractSliceBuffers,
  remapBox2dFromSlice,
  computeIou,
  deduplicateSliceDetections,
  DEFAULT_SLICE_COUNT,
  DEFAULT_SLICE_OVERLAP_RATIO,
} = require('../services/visionSlicer');
const sharp = require('sharp');

async function createJpegBuffer(width = 1200, height = 800) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 60, b: 90 },
    },
  }).jpeg().toBuffer();
}

describe('visionSlicer', () => {
  describe('computeSliceRects', () => {
    it('produces the expected number of slices', () => {
      const rects = computeSliceRects(1200, 800, { sliceCount: 4 });
      expect(rects).toHaveLength(4);
      rects.forEach((r, i) => {
        expect(r.sliceId).toBe(i);
        expect(r.top).toBe(0);
        expect(r.height).toBe(800);
        expect(r.width).toBeGreaterThan(0);
      });
    });

    it('slices cover the full image width', () => {
      const rects = computeSliceRects(1000, 500, { sliceCount: 4, overlapRatio: 0.12 });
      const minLeft = Math.min(...rects.map(r => r.left));
      const maxRight = Math.max(...rects.map(r => r.left + r.width));
      expect(minLeft).toBe(0);
      expect(maxRight).toBe(1000);
    });

    it('applies overlap between adjacent slices', () => {
      const rects = computeSliceRects(1200, 800, { sliceCount: 4, overlapRatio: 0.12 });
      for (let i = 1; i < rects.length; i += 1) {
        const prev = rects[i - 1];
        const cur = rects[i];
        const overlap = (prev.left + prev.width) - cur.left;
        expect(overlap).toBeGreaterThan(0);
      }
    });

    it('throws on invalid dimensions', () => {
      expect(() => computeSliceRects(0, 800)).toThrow(/valid image dimensions/);
      expect(() => computeSliceRects(1200, -1)).toThrow(/valid image dimensions/);
    });

    it('clamps overlap ratio to max 0.49', () => {
      const rects = computeSliceRects(1000, 500, { sliceCount: 2, overlapRatio: 0.99 });
      expect(rects).toHaveLength(2);
      // Should not collapse slices into one
      expect(rects[0].width).toBeLessThan(1000);
    });

    it('defaults to DEFAULT_SLICE_COUNT and DEFAULT_SLICE_OVERLAP_RATIO', () => {
      const rects = computeSliceRects(1200, 800);
      expect(rects).toHaveLength(DEFAULT_SLICE_COUNT);
    });
  });

  describe('extractSliceBuffers', () => {
    it('extracts JPEG buffers for each slice rect', async () => {
      const imageBuffer = await createJpegBuffer(1200, 800);
      const rects = computeSliceRects(1200, 800, { sliceCount: 3 });
      const buffers = await extractSliceBuffers(imageBuffer, rects);

      expect(buffers).toHaveLength(3);
      for (const slice of buffers) {
        expect(Buffer.isBuffer(slice.buffer)).toBe(true);
        expect(slice.contentType).toBe('image/jpeg');
        expect(slice.width).toBeGreaterThan(0);
        expect(slice.height).toBe(800);
      }
    });

    it('throws on empty buffer', async () => {
      await expect(extractSliceBuffers(Buffer.alloc(0), [{ sliceId: 0, left: 0, top: 0, width: 100, height: 100 }]))
        .rejects.toThrow(/non-empty/);
    });

    it('returns empty array for empty sliceRects', async () => {
      const imageBuffer = await createJpegBuffer(100, 100);
      const result = await extractSliceBuffers(imageBuffer, []);
      expect(result).toEqual([]);
    });
  });

  describe('remapBox2dFromSlice', () => {
    it('remaps a centered box from the first slice', () => {
      const sliceRect = { left: 0, top: 0, width: 350, height: 800 };
      const box2d = [250, 250, 750, 750]; // center of slice
      const result = remapBox2dFromSlice(box2d, sliceRect, 1200, 800);

      expect(result).not.toBeNull();
      const [yMin, xMin, yMax, xMax] = result;
      // Y should be unchanged (slice is full height)
      expect(yMin).toBe(250);
      expect(yMax).toBe(750);
      // X should be scaled to ~73 to ~219 in 1200px (350/1200 = 0.292 of full width)
      expect(xMin).toBeLessThan(250);
      expect(xMax).toBeLessThan(750);
    });

    it('remaps a box from a later slice with left offset', () => {
      const sliceRect = { left: 600, top: 0, width: 350, height: 800 };
      const box2d = [0, 0, 1000, 1000]; // full slice
      const result = remapBox2dFromSlice(box2d, sliceRect, 1200, 800);

      expect(result).not.toBeNull();
      const [yMin, xMin, yMax, xMax] = result;
      expect(yMin).toBe(0);
      expect(yMax).toBe(1000);
      expect(xMin).toBe(500); // 600/1200 * 1000
      expect(xMax).toBeCloseTo(792, 0); // (600+350)/1200 * 1000
    });

    it('returns null for invalid inputs', () => {
      expect(remapBox2dFromSlice(null, { left: 0, top: 0, width: 100, height: 100 }, 1200, 800)).toBeNull();
      expect(remapBox2dFromSlice([0, 0, 1000, 1000], null, 1200, 800)).toBeNull();
      expect(remapBox2dFromSlice([0, 0, 1000, 1000], { left: 0, top: 0, width: 0, height: 100 }, 1200, 800)).toBeNull();
    });
  });

  describe('computeIou', () => {
    it('returns 1 for identical boxes', () => {
      expect(computeIou([100, 200, 500, 600], [100, 200, 500, 600])).toBeCloseTo(1.0);
    });

    it('returns 0 for non-overlapping boxes', () => {
      expect(computeIou([0, 0, 100, 100], [500, 500, 600, 600])).toBe(0);
    });

    it('returns a value between 0 and 1 for partially overlapping boxes', () => {
      const iou = computeIou([0, 0, 500, 500], [250, 250, 750, 750]);
      expect(iou).toBeGreaterThan(0);
      expect(iou).toBeLessThan(1);
    });

    it('returns 0 for null inputs', () => {
      expect(computeIou(null, [0, 0, 500, 500])).toBe(0);
      expect(computeIou([0, 0, 500, 500], null)).toBe(0);
    });
  });

  describe('deduplicateSliceDetections', () => {
    it('removes duplicates with same title and overlapping boxes', () => {
      const detections = [
        { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', box2d: [100, 200, 400, 350], confidence: 0.9 },
        { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', box2d: [105, 205, 395, 345], confidence: 0.85 },
      ];

      const { detections: deduped, dedupedCount } = deduplicateSliceDetections(detections);
      expect(deduped).toHaveLength(1);
      expect(dedupedCount).toBe(1);
      expect(deduped[0].confidence).toBe(0.9); // higher confidence kept
    });

    it('keeps items with different titles', () => {
      const detections = [
        { title: 'Book A', box2d: [100, 200, 400, 350], confidence: 0.9 },
        { title: 'Book B', box2d: [105, 205, 395, 345], confidence: 0.85 },
      ];

      const { detections: deduped } = deduplicateSliceDetections(detections);
      expect(deduped).toHaveLength(2);
    });

    it('keeps items with same title but non-overlapping boxes', () => {
      const detections = [
        { title: 'Book A', box2d: [0, 0, 100, 100], confidence: 0.9 },
        { title: 'Book A', box2d: [800, 800, 1000, 1000], confidence: 0.85 },
      ];

      const { detections: deduped } = deduplicateSliceDetections(detections);
      expect(deduped).toHaveLength(2);
    });

    it('prefers the higher-confidence detection on duplicate', () => {
      const detections = [
        { title: 'Book A', box2d: [100, 200, 400, 350], confidence: 0.7 },
        { title: 'Book A', box2d: [100, 200, 400, 350], confidence: 0.95 },
      ];

      const { detections: deduped } = deduplicateSliceDetections(detections);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].confidence).toBe(0.95);
    });

    it('passes through items without title or box2d', () => {
      const detections = [
        { box2d: [0, 0, 500, 500], confidence: 0.8 },
        { title: 'Book A', confidence: 0.9 },
      ];

      const { detections: deduped, dedupedCount } = deduplicateSliceDetections(detections);
      expect(deduped).toHaveLength(2);
      expect(dedupedCount).toBe(0);
    });

    it('handles empty input', () => {
      const { detections: deduped, dedupedCount } = deduplicateSliceDetections([]);
      expect(deduped).toHaveLength(0);
      expect(dedupedCount).toBe(0);
    });

    it('respects custom iouThreshold', () => {
      const detections = [
        { title: 'Book A', box2d: [0, 0, 500, 500], confidence: 0.9 },
        { title: 'Book A', box2d: [200, 200, 700, 700], confidence: 0.85 },
      ];

      // With very high threshold, they won't be considered duplicates
      const { detections: deduped } = deduplicateSliceDetections(detections, { iouThreshold: 0.99 });
      expect(deduped).toHaveLength(2);
    });

    it('deduplicates items differing only by leading article (canonical match)', () => {
      const detections = [
        { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', box2d: [100, 200, 400, 350], confidence: 0.9 },
        { title: 'Great Gatsby', author: 'F. Scott Fitzgerald', box2d: [105, 205, 395, 345], confidence: 0.85 },
      ];

      const { detections: deduped, dedupedCount } = deduplicateSliceDetections(detections);
      expect(deduped).toHaveLength(1);
      expect(dedupedCount).toBe(1);
      expect(deduped[0].confidence).toBe(0.9);
    });

    it('deduplicates items differing by whitespace and punctuation (canonical match)', () => {
      const detections = [
        { title: 'A Tale of Two Cities', author: 'Charles Dickens', box2d: [100, 100, 500, 300], confidence: 0.88 },
        { title: 'Tale of Two Cities', author: 'Charles  Dickens', box2d: [102, 102, 498, 298], confidence: 0.92 },
      ];

      const { detections: deduped, dedupedCount } = deduplicateSliceDetections(detections);
      expect(deduped).toHaveLength(1);
      expect(dedupedCount).toBe(1);
      // Higher confidence wins
      expect(deduped[0].confidence).toBe(0.92);
    });
  });
});
