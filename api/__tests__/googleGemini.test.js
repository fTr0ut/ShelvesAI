const { GoogleGeminiService } = require('../services/googleGemini');

// Mock GoogleGenerativeAI
jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({
            generateContent: jest.fn(),
            startChat: jest.fn(),
        })
    }))
}));

describe('GoogleGeminiService', () => {
    let service;
    let mockGenerateContent;

    beforeEach(() => {
        process.env.GOOGLE_GEN_AI_KEY = 'test-key';
        delete process.env.VISION_OTHER_FIRST_PASS_THINKING_BUDGET;
        delete process.env.VISION_OTHER_SECOND_PASS_THINKING_BUDGET;
        service = new GoogleGeminiService();
        mockGenerateContent = service.model.generateContent;
        mockGenerateContent.mockReset();
        if (service.visionModel?.startChat?.mockReset) {
            service.visionModel.startChat.mockReset();
        }
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

        it('uses music-specific enrichment instructions for vinyl (not book-specific)', async () => {
            mockGenerateContent.mockResolvedValue({
                response: {
                    text: () => JSON.stringify([
                        { title: 'Ctrl', primaryCreator: 'SZA', kind: 'vinyl' },
                    ]),
                },
            });

            await service.enrichWithSchema([{ title: 'Ctrl', author: 'SZA' }], 'vinyl');

            const request = mockGenerateContent.mock.calls[0][0];
            const promptText = request?.contents?.[0]?.parts?.[0]?.text || '';
            expect(promptText).toMatch(/For music, include:/i);
            expect(promptText).not.toMatch(/For books, include:/i);
            expect(promptText).toMatch(/Vinyl LP/i);
        });
    });

    describe('detectShelfItemsFromImage', () => {
        it('uses first-pass other budget env var and enables googleSearch grounding', async () => {
            process.env.VISION_OTHER_FIRST_PASS_THINKING_BUDGET = '1234';
            const mockVisionGenerateContent = service.visionModel.generateContent;

            mockVisionGenerateContent.mockResolvedValue({
                response: {
                    text: () => JSON.stringify([{ title: 'Bottle A', confidence: 0.9 }]),
                    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
                }
            });

            await service.detectShelfItemsFromImage(
                'data:image/jpeg;base64,aabbcc',
                'other',
            );

            const request = mockVisionGenerateContent.mock.calls[0][0];
            expect(request.generationConfig.thinkingConfig.thinkingBudget).toBe(1234);
            expect(request.tools).toEqual([{ googleSearch: {} }]);
        });

        it('uses second-pass other budget env var and augments prompt with low-confidence hints', async () => {
            process.env.VISION_OTHER_SECOND_PASS_THINKING_BUDGET = '2345';
            const mockVisionGenerateContent = service.visionModel.generateContent;

            mockVisionGenerateContent.mockResolvedValue({
                response: {
                    text: () => JSON.stringify([
                        { title: 'Bottle A', confidence: 0.95, extractionIndex: 3 },
                    ]),
                    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
                }
            });

            await service.detectShelfItemsFromImage(
                'data:image/jpeg;base64,aabbcc',
                'other',
                null,
                null,
                {
                    pass: 'second',
                    lowConfidenceItems: [
                        {
                            extractionIndex: 3,
                            title: 'Bttle A',
                            author: 'Maker X',
                            barcode: '123456789012',
                        },
                    ],
                },
            );

            const request = mockVisionGenerateContent.mock.calls[0][0];
            const promptText = request.contents?.[0]?.parts?.[0]?.text || '';
            expect(request.generationConfig.thinkingConfig.thinkingBudget).toBe(2345);
            expect(request.tools).toEqual([{ googleSearch: {} }]);
            expect(promptText).toMatch(/SECOND PASS INSTRUCTIONS/i);
            expect(promptText).toMatch(/extractionIndex=3/i);
        });

        it('uses chat mode for second-pass other extraction when prior conversation history is provided', async () => {
            process.env.VISION_OTHER_SECOND_PASS_THINKING_BUDGET = '2345';
            const sendMessage = jest.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify([
                        { title: 'Bottle A', confidence: 0.95, extractionIndex: 3 },
                    ]),
                    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
                }
            });
            service.visionModel.startChat.mockReturnValue({ sendMessage });

            const priorConversationHistory = [
                { role: 'user', parts: [{ text: 'first pass prompt' }] },
                { role: 'model', parts: [{ text: 'first pass result' }] },
            ];

            await service.detectShelfItemsFromImage(
                'data:image/jpeg;base64,aabbcc',
                'other',
                null,
                null,
                {
                    pass: 'second',
                    lowConfidenceItems: [{ extractionIndex: 3, title: 'Bottle A' }],
                    conversationHistory: priorConversationHistory,
                },
            );

            expect(service.visionModel.startChat).toHaveBeenCalledWith(
                expect.objectContaining({
                    history: priorConversationHistory,
                    tools: [{ googleSearch: {} }],
                    generationConfig: {
                        thinkingConfig: {
                            thinkingBudget: 2345,
                        },
                    },
                }),
            );
            expect(sendMessage).toHaveBeenCalledWith(expect.stringMatching(/SECOND PASS INSTRUCTIONS/i));
            expect(service.visionModel.generateContent).not.toHaveBeenCalled();
        });

        it('keeps standard shelf vision budget at 0 and does not enable tools', async () => {
            process.env.VISION_OTHER_FIRST_PASS_THINKING_BUDGET = '9999';
            const mockVisionGenerateContent = service.visionModel.generateContent;

            mockVisionGenerateContent.mockResolvedValue({
                response: {
                    text: () => JSON.stringify([{ title: 'Dune', confidence: 0.9 }]),
                    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
                }
            });

            await service.detectShelfItemsFromImage(
                'data:image/jpeg;base64,aabbcc',
                'book',
            );

            const request = mockVisionGenerateContent.mock.calls[0][0];
            expect(request.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
            expect(request.tools).toBeUndefined();
        });

        it('requests a confidence patch when confidence is missing and merges patched values by extractionIndex', async () => {
            const sendMessage = jest.fn().mockResolvedValue({
                response: {
                    text: () => JSON.stringify([{ extractionIndex: 0, confidence: 0.88 }]),
                    candidates: [{ content: { role: 'model', parts: [{ text: 'patched' }] } }],
                },
            });
            service.visionModel.startChat.mockReturnValue({ sendMessage });
            service.visionModel.generateContent.mockResolvedValue({
                response: {
                    text: () => JSON.stringify([
                        { title: 'Ctrl', author: 'SZA' },
                        { title: 'Dune', author: 'Frank Herbert', confidence: 0.95 },
                    ]),
                    candidates: [{ content: { role: 'model', parts: [{ text: 'first pass' }] } }],
                },
            });

            const result = await service.detectShelfItemsFromImage(
                'data:image/jpeg;base64,aabbcc',
                'book',
            );

            expect(service.visionModel.startChat).toHaveBeenCalledWith(
                expect.objectContaining({
                    generationConfig: expect.objectContaining({
                        maxOutputTokens: 512,
                        thinkingConfig: { thinkingBudget: 0 },
                    }),
                }),
            );
            expect(sendMessage).toHaveBeenCalledWith(expect.stringMatching(/extractionIndex=0/i));
            expect(result.items[0].confidence).toBe(0.88);
            expect(result.items[0].confidenceProvided).toBe(true);
            expect(result.items[1].confidence).toBe(0.95);
        });

        it('keeps fallback confidence when confidence patch retry fails', async () => {
            service.visionModel.startChat.mockReturnValue({
                sendMessage: jest.fn().mockRejectedValue(new Error('patch failed')),
            });
            service.visionModel.generateContent.mockResolvedValue({
                response: {
                    text: () => JSON.stringify([
                        { title: 'Ctrl', author: 'SZA' },
                    ]),
                    candidates: [{ content: { role: 'model', parts: [{ text: 'first pass' }] } }],
                },
            });

            const result = await service.detectShelfItemsFromImage(
                'data:image/jpeg;base64,aabbcc',
                'book',
            );

            expect(result.items).toHaveLength(1);
            expect(result.items[0].confidence).toBe(0.7);
            expect(result.items[0].confidenceProvided).toBe(false);
        });

        it('should recover complete items from truncated JSON response', async () => {
            service.visionModel.generateContent.mockResolvedValue({
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

        it('repairs malformed JSON values like "box_2d":, and preserves extracted items', async () => {
            service.visionModel.generateContent.mockResolvedValue({
                response: {
                    text: () => '[{"title":"Kirkland Signature Bordeaux Supérieur","author":"Kirkland Signature","box_2d":,"confidence":0.95}]',
                    candidates: [{ content: { role: 'model', parts: [{ text: 'partial' }] } }],
                }
            });

            const result = await service.detectShelfItemsFromImage(
                'data:image/jpeg;base64,aabbcc',
                'other',
            );

            expect(result.items).toHaveLength(1);
            expect(result.items[0]).toMatchObject({
                title: 'Kirkland Signature Bordeaux Supérieur',
                author: 'Kirkland Signature',
                confidence: 0.95,
                box2d: null,
            });
            expect(result.warning).toMatch(/malformed/i);
        });

        it('normalizes box_2d and assigns extractionIndex for parsed items', async () => {
            service.visionModel.generateContent.mockResolvedValue({
                response: {
                    text: () => JSON.stringify([
                        {
                            title: 'Dune',
                            author: 'Frank Herbert',
                            box_2d: [120.4, -10, 1004, 180.9],
                            confidence: 0.95,
                        },
                        {
                            title: 'Invalid Box',
                            author: 'Unknown',
                            box_2d: [0, 0, 0, 0],
                            confidence: 0.2,
                        },
                    ]),
                    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
                }
            });

            const result = await service.detectShelfItemsFromImage(
                'data:image/jpeg;base64,aabbcc',
                'book',
            );

            expect(result.items).toHaveLength(2);
            expect(result.items[0].box2d).toEqual([120, 0, 1000, 181]);
            expect(result.items[0].extractionIndex).toBe(0);
            expect(result.items[1].box2d).toBeNull();
            expect(result.items[1].extractionIndex).toBe(1);
        });

        it('should throw a provider unavailable error when Gemini request fails', async () => {
            service.visionModel.generateContent.mockRejectedValue(new TypeError('fetch failed'));

            await expect(
                service.detectShelfItemsFromImage('data:image/jpeg;base64,aabbcc', 'book')
            ).rejects.toMatchObject({
                code: 'VISION_PROVIDER_UNAVAILABLE',
            });
        });
    });
});
