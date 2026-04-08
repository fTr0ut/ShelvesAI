const sharp = require('sharp');
const { createVisionCropService } = require('@shelvesai/vision-crops');

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

function buildService(overrides = {}) {
  const logger = {
    warn: jest.fn(),
    info: jest.fn(),
  };
  const scanPhoto = {
    id: 77,
    width: 1200,
    height: 800,
    contentType: 'image/jpeg',
  };
  const region = {
    id: 8,
    box2d: [100, 200, 700, 900],
  };
  const base = {
    scanPhotos: {
      getByIdForUser: jest.fn().mockResolvedValue(scanPhoto),
      loadImageBuffer: jest.fn(),
    },
    regions: {
      getByIdForScan: jest.fn().mockResolvedValue(region),
      getByExtractionIndexForScan: jest.fn().mockResolvedValue(region),
      listForScan: jest.fn().mockResolvedValue([region]),
      linkCollectable: jest.fn().mockResolvedValue(null),
      linkManual: jest.fn().mockResolvedValue(null),
      linkCollectionItem: jest.fn().mockResolvedValue(null),
      hasCollectionItemLinkForReference: jest.fn().mockResolvedValue(false),
    },
    crops: {
      getByRegionIdForUser: jest.fn().mockResolvedValue(null),
      listForScan: jest.fn().mockResolvedValue([]),
      upsertFromBuffer: jest.fn().mockResolvedValue({
        id: 902,
        regionId: 8,
        contentType: 'image/jpeg',
      }),
      loadImageBuffer: jest.fn(),
    },
    attachments: {
      getCollectionItemByIdForShelf: jest.fn().mockResolvedValue(null),
      findCollectionByReference: jest.fn().mockResolvedValue(null),
      attachVisionCropToItem: jest.fn().mockResolvedValue(null),
    },
    manualCovers: {
      getManualCoverState: jest.fn().mockResolvedValue({ hasPrimaryCover: false }),
      uploadFromBuffer: jest.fn().mockResolvedValue(null),
    },
    queue: null,
    buildCropUrl: ({ shelfId, scanPhotoId, regionId }) => `/api/shelves/${shelfId}/vision/scans/${scanPhotoId}/regions/${regionId}/crop`,
    logger,
    settings: {
      warmupEnabled: true,
      warmupMaxRegions: 50,
      warmupPressureMaxRegions: 10,
      warmupDeferQueueDepth: 12,
      workflowTypeVision: 'vision',
      notifyForceLongPosition: 3,
    },
  };

  const deps = {
    ...base,
    ...overrides,
    scanPhotos: { ...base.scanPhotos, ...(overrides.scanPhotos || {}) },
    regions: { ...base.regions, ...(overrides.regions || {}) },
    crops: { ...base.crops, ...(overrides.crops || {}) },
    attachments: { ...base.attachments, ...(overrides.attachments || {}) },
    manualCovers: { ...base.manualCovers, ...(overrides.manualCovers || {}) },
    settings: { ...base.settings, ...(overrides.settings || {}) },
  };

  return {
    service: createVisionCropService(deps),
    deps,
    logger,
    scanPhoto,
    region,
  };
}

describe('vision crop package service', () => {
  it('returns a cached crop without recomputing', async () => {
    const cropBuffer = Buffer.from('existing-crop');
    const { service, deps } = buildService({
      crops: {
        getByRegionIdForUser: jest.fn().mockResolvedValue({
          id: 901,
          regionId: 8,
          contentType: 'image/jpeg',
        }),
        loadImageBuffer: jest.fn().mockResolvedValue({
          buffer: cropBuffer,
          contentType: 'image/jpeg',
          contentLength: cropBuffer.length,
        }),
      },
    });

    const result = await service.getOrCreateRegionCrop({
      userId: 1,
      shelfId: 10,
      shelfType: 'books',
      scanPhotoId: 77,
      regionId: 8,
    });

    expect(deps.scanPhotos.loadImageBuffer).not.toHaveBeenCalled();
    expect(result.payload.buffer).toBe(cropBuffer);
  });

  it('extracts and persists a crop on cache miss', async () => {
    const scanBuffer = await createJpegBuffer(1200, 800);
    const { service, deps } = buildService({
      scanPhotos: {
        loadImageBuffer: jest.fn().mockResolvedValue({
          buffer: scanBuffer,
          contentType: 'image/jpeg',
          contentLength: scanBuffer.length,
        }),
      },
    });

    const result = await service.getOrCreateRegionCrop({
      userId: 1,
      shelfId: 10,
      shelfType: 'books',
      scanPhotoId: 77,
      regionId: 8,
    });

    expect(deps.crops.upsertFromBuffer).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      shelfId: 10,
      scanPhotoId: 77,
      regionId: 8,
      width: 840,
      height: 480,
    }));
    expect(Buffer.isBuffer(result.payload.buffer)).toBe(true);
  });

  it('warms only uncropped regions', async () => {
    const scanBuffer = await createJpegBuffer(1200, 800);
    const { service, deps } = buildService({
      regions: {
        listForScan: jest.fn().mockResolvedValue([
          { id: 1, box2d: [100, 200, 700, 900] },
          { id: 2, box2d: [100, 200, 700, 900] },
        ]),
      },
      crops: {
        listForScan: jest.fn().mockResolvedValue([{ regionId: 1 }]),
        upsertFromBuffer: jest.fn().mockResolvedValue({ id: 999, regionId: 2, contentType: 'image/jpeg' }),
      },
      scanPhotos: {
        loadImageBuffer: jest.fn().mockResolvedValue({
          buffer: scanBuffer,
          contentType: 'image/jpeg',
          contentLength: scanBuffer.length,
        }),
      },
    });

    await service.warmScanCrops({
      userId: 1,
      shelfId: 10,
      shelfType: 'books',
      scanPhotoId: 77,
    });

    expect(deps.crops.upsertFromBuffer).toHaveBeenCalledTimes(1);
    expect(deps.crops.upsertFromBuffer).toHaveBeenCalledWith(expect.objectContaining({ regionId: 2 }));
  });

  it('caps warmup under queue pressure', async () => {
    const scanBuffer = await createJpegBuffer(1200, 800);
    const { service, deps } = buildService({
      regions: {
        listForScan: jest.fn().mockResolvedValue([
          { id: 1, box2d: [100, 200, 700, 900] },
          { id: 2, box2d: [100, 200, 700, 900] },
          { id: 3, box2d: [100, 200, 700, 900] },
        ]),
      },
      queue: {
        countQueuedVisionJobs: jest.fn().mockResolvedValue(5),
        getSettings: jest.fn().mockResolvedValue({ workflowQueueLongThresholdPosition: 3 }),
      },
      settings: {
        warmupMaxRegions: 5,
        warmupPressureMaxRegions: 1,
      },
      scanPhotos: {
        loadImageBuffer: jest.fn().mockResolvedValue({
          buffer: scanBuffer,
          contentType: 'image/jpeg',
          contentLength: scanBuffer.length,
        }),
      },
    });

    await service.warmScanCrops({
      userId: 1,
      shelfId: 10,
      shelfType: 'books',
      scanPhotoId: 77,
    });

    expect(deps.crops.upsertFromBuffer).toHaveBeenCalledTimes(1);
  });

  it('defers warmup entirely when queue depth is too high', async () => {
    const { service, deps } = buildService({
      queue: {
        countQueuedVisionJobs: jest.fn().mockResolvedValue(12),
        getSettings: jest.fn().mockResolvedValue({ workflowQueueLongThresholdPosition: 3 }),
      },
      settings: {
        warmupDeferQueueDepth: 12,
      },
    });

    const result = await service.warmScanCrops({
      userId: 1,
      shelfId: 10,
      shelfType: 'books',
      scanPhotoId: 77,
    });

    expect(result).toEqual(expect.objectContaining({ skipped: true, reason: 'queue_pressure' }));
    expect(deps.crops.upsertFromBuffer).not.toHaveBeenCalled();
  });

  it('relinks review artifacts and reattaches the crop', async () => {
    const cropBuffer = Buffer.from('existing-crop');
    const { service, deps } = buildService({
      crops: {
        getByRegionIdForUser: jest.fn().mockResolvedValue({
          id: 901,
          regionId: 8,
          contentType: 'image/jpeg',
        }),
        loadImageBuffer: jest.fn().mockResolvedValue({
          buffer: cropBuffer,
          contentType: 'image/jpeg',
          contentLength: cropBuffer.length,
        }),
      },
      attachments: {
        getCollectionItemByIdForShelf: jest.fn().mockResolvedValue({ id: 1201, userId: 1 }),
        attachVisionCropToItem: jest.fn().mockResolvedValue({
          ownerPhotoSource: 'vision_crop',
          ownerPhotoVisible: false,
        }),
      },
    });

    const result = await service.restoreCropLinkageForReviewItem({
      userId: 1,
      shelfId: 10,
      shelfType: 'other',
      scanPhotoId: 77,
      extractionIndex: 4,
      manualId: 1301,
      collectionItemId: 1201,
    });

    expect(result).toEqual({ relinked: true, attachedCrop: true });
    expect(deps.regions.linkManual).toHaveBeenCalledWith({
      scanPhotoId: 77,
      extractionIndex: 4,
      manualId: 1301,
    });
    expect(deps.regions.linkCollectionItem).toHaveBeenCalledWith({
      scanPhotoId: 77,
      extractionIndex: 4,
      collectionItemId: 1201,
    });
    expect(deps.attachments.attachVisionCropToItem).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 1201,
      cropId: 901,
    }));
  });

  it('skips fallback attachment for non-winning duplicate regions', async () => {
    const cropBuffer = Buffer.from('existing-crop');
    const { service, deps } = buildService({
      regions: {
        getByIdForScan: jest.fn().mockResolvedValue({
          id: 8,
          scanPhotoId: 77,
          manualId: 808,
          box2d: [100, 200, 700, 900],
        }),
        hasCollectionItemLinkForReference: jest.fn().mockResolvedValue(true),
      },
      crops: {
        getByRegionIdForUser: jest.fn().mockResolvedValue({
          id: 901,
          regionId: 8,
          contentType: 'image/jpeg',
        }),
        loadImageBuffer: jest.fn().mockResolvedValue({
          buffer: cropBuffer,
          contentType: 'image/jpeg',
          contentLength: cropBuffer.length,
        }),
      },
    });

    await service.getOrCreateRegionCrop({
      userId: 1,
      shelfId: 10,
      shelfType: 'other',
      scanPhotoId: 77,
      regionId: 8,
    });

    expect(deps.attachments.findCollectionByReference).not.toHaveBeenCalled();
    expect(deps.attachments.attachVisionCropToItem).not.toHaveBeenCalled();
  });

  it('promotes manual covers only for shareable other-shelf crop attachments', async () => {
    const cropBuffer = Buffer.from('existing-crop');
    const { service, deps } = buildService({
      regions: {
        getByIdForScan: jest.fn().mockResolvedValue({
          id: 8,
          scanPhotoId: 77,
          manualId: 808,
          box2d: [100, 200, 700, 900],
        }),
      },
      crops: {
        getByRegionIdForUser: jest.fn().mockResolvedValue({
          id: 901,
          regionId: 8,
          contentType: 'image/jpeg',
        }),
        loadImageBuffer: jest.fn().mockResolvedValue({
          buffer: cropBuffer,
          contentType: 'image/jpeg',
          contentLength: cropBuffer.length,
        }),
      },
      attachments: {
        findCollectionByReference: jest.fn().mockResolvedValue({ id: 55 }),
        attachVisionCropToItem: jest.fn().mockResolvedValue({
          ownerPhotoSource: 'vision_crop',
          ownerPhotoVisible: true,
        }),
      },
    });

    await service.getOrCreateRegionCrop({
      userId: 1,
      shelfId: 10,
      shelfType: 'other',
      scanPhotoId: 77,
      regionId: 8,
    });

    expect(deps.manualCovers.uploadFromBuffer).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      manualId: 808,
      buffer: cropBuffer,
      contentType: 'image/jpeg',
    }));
  });

  it('falls back cleanly when the crop table is unavailable', async () => {
    const scanBuffer = await createJpegBuffer(1200, 800);
    const missingRelationError = new Error('relation "vision_item_crops" does not exist');
    missingRelationError.code = '42P01';
    const { service, deps } = buildService({
      scanPhotos: {
        loadImageBuffer: jest.fn().mockResolvedValue({
          buffer: scanBuffer,
          contentType: 'image/jpeg',
          contentLength: scanBuffer.length,
        }),
      },
      crops: {
        getByRegionIdForUser: jest.fn().mockRejectedValue(missingRelationError),
        upsertFromBuffer: jest.fn().mockRejectedValue(missingRelationError),
      },
    });

    const result = await service.getOrCreateRegionCrop({
      userId: 1,
      shelfId: 10,
      shelfType: 'books',
      scanPhotoId: 77,
      regionId: 8,
    });

    expect(Buffer.isBuffer(result.payload.buffer)).toBe(true);
    expect(deps.crops.upsertFromBuffer).not.toHaveBeenCalled();
  });
});
