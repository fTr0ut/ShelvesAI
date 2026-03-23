const { GoogleGeminiService } = require('../services/googleGemini');

// Mock GoogleGenerativeAI
jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({
            generateContent: jest.fn()
        })
    }))
}));

describe('GoogleGeminiService', () => {
    let service;
    let mockGenerateContent;

    beforeEach(() => {
        process.env.GOOGLE_GEN_AI_KEY = 'test-key';
        service = new GoogleGeminiService();
        mockGenerateContent = service.model.generateContent;
    });

    describe('enrichWithSchema', () => {
        it('should return enriched items when API returns valid JSON', async () => {
            const mockResponse = [
                {
                    title: "Test Book",
                    primaryCreator: "Test Author",
                    kind: "book",
                    publishers: ["Test Pub"],
                    year: "2023",
                    confidence: 0.9
                }
            ];

            mockGenerateContent.mockResolvedValue({
                response: {
                    text: () => JSON.stringify(mockResponse)
                }
            });

            const inputItems = [{ title: "Test Book", author: "Test Author" }];
            const result = await service.enrichWithSchema(inputItems, 'book');

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                title: "Test Book",
                primaryCreator: "Test Author",
                kind: "books"
            });
            expect(result[0].source).toBe('gemini-schema-enriched');
        });

        it('should handle markdown code blocks in response', async () => {
            const mockResponse = [
                { title: "Cleaned Title", kind: "game" }
            ];

            mockGenerateContent.mockResolvedValue({
                response: {
                    text: () => "```json\n" + JSON.stringify(mockResponse) + "\n```"
                }
            });

            const inputItems = [{ name: "Raw Title" }];
            const result = await service.enrichWithSchema(inputItems, 'game');

            expect(result[0].title).toBe("Cleaned Title");
        });

        it('should use fallback if API response is invalid JSON', async () => {
            mockGenerateContent.mockResolvedValue({
                response: {
                    text: () => "I cannot do that."
                }
            });

            // Suppress console.error for this test
            jest.spyOn(console, 'error').mockImplementation(() => { });

            const inputItems = [{ title: "Fallback Item", author: "Unknown" }];
            const result = await service.enrichWithSchema(inputItems, 'book');

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                title: "Fallback Item",
                confidence: 0.5,
                notes: "Enrichment failed"
            });
        });

        it('should handle null/empty input', async () => {
            const result = await service.enrichWithSchema([], 'book');
            expect(result).toEqual([]);
        });
    });

    describe('detectShelfItemsFromImage', () => {
        it('should recover complete items from truncated JSON response', async () => {
            mockGenerateContent.mockResolvedValue({
                response: {
                    text: () => '[{"title":"Dune","author":"Frank Herbert","confidence":0.95},{"title":"Found',
                    candidates: [{ content: { role: 'model', parts: [{ text: 'partial' }] } }],
                }
            });

            const result = await service.detectShelfItemsFromImage(
                'data:image/jpeg;base64,aabbcc',
                'book',
            );

            expect(result.items).toHaveLength(1);
            expect(result.items[0]).toMatchObject({
                title: 'Dune',
                name: 'Dune',
                author: 'Frank Herbert',
                confidence: 0.95,
            });
            expect(result.warning).toMatch(/truncated/i);
        });

        it('should throw a provider unavailable error when Gemini request fails', async () => {
            mockGenerateContent.mockRejectedValue(new TypeError('fetch failed'));

            await expect(
                service.detectShelfItemsFromImage('data:image/jpeg;base64,aabbcc', 'book')
            ).rejects.toMatchObject({
                code: 'VISION_PROVIDER_UNAVAILABLE',
            });
        });
    });
});
