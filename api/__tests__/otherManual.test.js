const {
    canonicalizeOtherManualText,
    normalizeBarcode,
    hasRequiredOtherFields,
    dedupeOtherManualCandidates,
    evaluateOtherManualFuzzyCandidate,
    getOtherManualDedupKey,
} = require('../services/manuals/otherManual');

describe('otherManual helpers', () => {
    it('canonicalizes text deterministically', () => {
        expect(canonicalizeOtherManualText('  Hélló---World!!  ')).toBe('hello world');
    });

    it('normalizes barcode to uppercase alphanumeric', () => {
        expect(normalizeBarcode('  01-234 56_78  ')).toBe('012345678');
    });

    it('requires title and primaryCreator for other-manual save', () => {
        expect(hasRequiredOtherFields({ title: 'Weller 12', primaryCreator: 'Buffalo Trace' })).toBe(true);
        expect(hasRequiredOtherFields({ title: 'Weller 12', primaryCreator: '' })).toBe(false);
        expect(hasRequiredOtherFields({ title: '', primaryCreator: 'Buffalo Trace' })).toBe(false);
    });

    it('builds dedupe key with barcode priority over fingerprint/canonical fields', () => {
        const key = getOtherManualDedupKey({
            title: 'Any',
            primaryCreator: 'Any',
            manualFingerprint: 'fp-123',
            barcode: 'abc-123',
        });
        expect(key).toBe('barcode:ABC123');
    });

    it('dedupes candidates by priority key and keeps highest-confidence item', () => {
        const items = [
            { title: 'Bottle A', primaryCreator: 'Buffalo Trace', barcode: '123-45', confidence: 0.55 },
            { title: 'Bottle A', primaryCreator: 'Buffalo Trace Distillery', barcode: '12345', confidence: 0.91, year: '2025' },
            { title: 'Bottle B', primaryCreator: 'Maker X', manualFingerprint: 'fp-b', confidence: 0.7 },
            { title: 'Bottle B', primaryCreator: 'Maker X', manualFingerprint: 'fp-b', confidence: 0.6, description: 'older' },
        ];

        const { deduped, droppedCount } = dedupeOtherManualCandidates(items);

        expect(droppedCount).toBe(2);
        expect(deduped).toHaveLength(2);
        expect(deduped[0].confidence).toBe(0.91);
        expect(deduped[0].year).toBe('2025');
        expect(deduped[1].manualFingerprint).toBe('fp-b');
        expect(deduped[1].confidence).toBe(0.7);
    });

    it('classifies fuzzy candidates with conservative thresholds', () => {
        expect(
            evaluateOtherManualFuzzyCandidate({ combinedSim: 0.93, titleSim: 0.91, creatorSim: 0.88 }).decision
        ).toBe('fuzzy_auto');
        expect(
            evaluateOtherManualFuzzyCandidate({ combinedSim: 0.85, titleSim: 0.79, creatorSim: 0.92 }).decision
        ).toBe('fuzzy_review');
        expect(
            evaluateOtherManualFuzzyCandidate({ combinedSim: 0.71, titleSim: 0.8, creatorSim: 0.5 }).decision
        ).toBe('none');
    });
});
