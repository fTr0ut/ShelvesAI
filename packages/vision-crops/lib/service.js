const { extractRegionCrop } = require('./visionCropper');

function defaultIsMissingRelationError(err, relationName) {
  if (!err) return false;
  if (err.code === '42P01') return true;
  if (!relationName) return false;
  return String(err.message || '').includes(relationName);
}

function getRegionBox2d(region) {
  if (!region || typeof region !== 'object') return null;
  if (Array.isArray(region.box2d)) return region.box2d;
  if (Array.isArray(region.box_2d)) return region.box_2d;
  return null;
}

function sanitizeBox2dForLog(box2d) {
  if (!Array.isArray(box2d)) return null;
  return box2d.slice(0, 4).map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric * 1000) / 1000;
  });
}

function resolveQueueCount(queue, settings) {
  if (!queue) return null;
  if (typeof queue.countQueuedVisionJobs === 'function') {
    return queue.countQueuedVisionJobs();
  }
  if (typeof queue.countQueued === 'function') {
    return queue.countQueued({ workflowType: settings?.workflowTypeVision || 'vision' });
  }
  return null;
}

function createVisionCropService(deps = {}) {
  const {
    scanPhotos,
    regions,
    crops,
    attachments,
    manualCovers,
    queue = null,
    buildCropUrl,
    isMissingRelationError = defaultIsMissingRelationError,
    logger = null,
    settings = {},
  } = deps;

  if (!scanPhotos || !regions || !crops || !attachments || !manualCovers || typeof buildCropUrl !== 'function') {
    throw new Error('createVisionCropService requires scanPhotos, regions, crops, attachments, manualCovers, and buildCropUrl');
  }

  const resolvedSettings = {
    warmupEnabled: settings.warmupEnabled !== false,
    warmupMaxRegions: Number.isFinite(Number(settings.warmupMaxRegions))
      ? Math.max(0, Number(settings.warmupMaxRegions))
      : 50,
    warmupPressureMaxRegions: Number.isFinite(Number(settings.warmupPressureMaxRegions))
      ? Math.max(0, Number(settings.warmupPressureMaxRegions))
      : 10,
    warmupDeferQueueDepth: Number.isFinite(Number(settings.warmupDeferQueueDepth))
      ? Math.max(0, Number(settings.warmupDeferQueueDepth))
      : 12,
    workflowTypeVision: settings.workflowTypeVision || 'vision',
    notifyForceLongPosition: Number.isFinite(Number(settings.notifyForceLongPosition))
      ? Math.max(0, Number(settings.notifyForceLongPosition))
      : 3,
  };

  async function extractVisionRegionCropPayload({ userId, shelfId, scanPhoto, region, scanImage = null }) {
    const sourceImage = scanImage || await scanPhotos.loadImageBuffer(scanPhoto);
    const extracted = await extractRegionCrop({
      imageBuffer: sourceImage.buffer,
      box2d: getRegionBox2d(region),
      imageWidth: scanPhoto.width,
      imageHeight: scanPhoto.height,
      coordinateMode: 'normalized',
      logger,
    });

    const crop = await crops.upsertFromBuffer({
      userId,
      shelfId,
      scanPhotoId: scanPhoto.id,
      regionId: region.id,
      buffer: extracted.buffer,
      contentType: extracted.contentType,
      width: extracted.width,
      height: extracted.height,
    });

    return {
      crop,
      scanImage: sourceImage,
      payload: {
        buffer: extracted.buffer,
        contentType: crop?.contentType || extracted.contentType || 'image/jpeg',
        contentLength: extracted.buffer.length,
      },
    };
  }

  async function attachCropToCollectionItem({ userId, shelfId, shelfType = null, region, crop }) {
    if (!crop || !region) return null;
    const normalizedShelfType = String(shelfType || '').toLowerCase();
    const collectionItemId = region.collectionItemId || region.collection_item_id || null;
    const collectableId = region.collectableId || region.collectable_id || null;
    const manualId = region.manualId || region.manual_id || null;
    let collectionItem = null;

    if (collectionItemId) {
      const byId = await attachments.getCollectionItemByIdForShelf(collectionItemId, shelfId);
      if (byId?.id && String(byId.userId) === String(userId)) {
        collectionItem = byId;
      } else if (logger && typeof logger.warn === 'function') {
        logger.warn('[Vision] Region collection item link did not resolve for user/shelf', {
          shelfId,
          regionId: region.id,
          collectionItemId,
        });
      }
    }

    if (!collectionItem?.id) {
      if (!collectableId && !manualId) return null;

      const scanPhotoId = region.scanPhotoId || region.scan_photo_id || null;
      if (scanPhotoId) {
        try {
          const hasLinkedWinner = await regions.hasCollectionItemLinkForReference({
            scanPhotoId,
            collectableId,
            manualId,
          });
          if (hasLinkedWinner) {
            if (logger && typeof logger.info === 'function') {
              logger.info('[Vision] Skipping fallback crop attach for non-winning duplicate region', {
                shelfId,
                scanPhotoId,
                regionId: region.id,
                collectableId,
                manualId,
              });
            }
            return null;
          }
        } catch (err) {
          if (err?.code !== '42P01' && err?.code !== '42703') {
            throw err;
          }
        }
      }

      collectionItem = await attachments.findCollectionByReference({
        userId,
        shelfId,
        collectableId,
        manualId,
      });
    }

    if (!collectionItem?.id) return null;

    let attached = null;
    try {
      attached = await attachments.attachVisionCropToItem({
        itemId: collectionItem.id,
        userId,
        shelfId,
        cropId: crop.id,
        contentType: crop.contentType || null,
        sizeBytes: crop.sizeBytes ?? null,
        width: crop.width ?? null,
        height: crop.height ?? null,
      });
    } catch (err) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[Vision] Failed to attach crop to collection item', {
          shelfId,
          regionId: region.id,
          cropId: crop.id,
          message: err?.message || String(err),
        });
      }
      attached = null;
    }

    const shouldPromoteManualCoverFromCrop = (
      manualId
      && normalizedShelfType === 'other'
      && attached
      && attached.ownerPhotoSource === 'vision_crop'
      && attached.ownerPhotoVisible === true
    );

    if (shouldPromoteManualCoverFromCrop) {
      try {
        const manualCoverState = await manualCovers.getManualCoverState({
          manualId,
          userId,
        });
        const hasPrimaryCover = !!manualCoverState?.hasPrimaryCover;
        if (!hasPrimaryCover) {
          const cropPayload = await crops.loadImageBuffer(crop);
          await manualCovers.uploadFromBuffer({
            userId,
            manualId,
            buffer: cropPayload.buffer,
            contentType: cropPayload.contentType || crop.contentType || 'image/jpeg',
          });
        }
      } catch (err) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('[Vision] Failed to promote manual cover from crop', {
            shelfId,
            manualId,
            regionId: region.id,
            cropId: crop.id,
            message: err?.message || String(err),
          });
        }
      }
    }

    return attached;
  }

  async function getOrCreateRegionCropFromEntities({ userId, shelfId, shelfType = null, scanPhoto, region }) {
    let crop = null;
    let cropTableAvailable = true;

    try {
      crop = await crops.getByRegionIdForUser({
        userId,
        shelfId,
        scanPhotoId: scanPhoto.id,
        regionId: region.id,
      });
    } catch (err) {
      if (!isMissingRelationError(err, 'vision_item_crops')) {
        throw err;
      }
      cropTableAvailable = false;
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[Vision] vision_item_crops table missing; generating crop without persistence.');
      }
    }

    if (crop) {
      await attachCropToCollectionItem({ userId, shelfId, shelfType, region, crop });
      const payload = await crops.loadImageBuffer(crop);
      return { scanPhoto, region, crop, payload };
    }

    const scanImage = await scanPhotos.loadImageBuffer(scanPhoto);
    const extracted = await extractRegionCrop({
      imageBuffer: scanImage.buffer,
      box2d: getRegionBox2d(region),
      imageWidth: scanPhoto.width,
      imageHeight: scanPhoto.height,
      coordinateMode: 'normalized',
      logger,
    });

    if (cropTableAvailable) {
      try {
        crop = await crops.upsertFromBuffer({
          userId,
          shelfId,
          scanPhotoId: scanPhoto.id,
          regionId: region.id,
          buffer: extracted.buffer,
          contentType: extracted.contentType,
          width: extracted.width,
          height: extracted.height,
        });
      } catch (persistErr) {
        if (!isMissingRelationError(persistErr, 'vision_item_crops')) {
          throw persistErr;
        }
        cropTableAvailable = false;
        if (logger && typeof logger.warn === 'function') {
          logger.warn('[Vision] vision_item_crops table missing while persisting crop; continuing without persistence.');
        }
      }
    }

    if (crop) {
      await attachCropToCollectionItem({ userId, shelfId, shelfType, region, crop });
    }

    return {
      scanPhoto,
      region,
      crop,
      payload: {
        buffer: extracted.buffer,
        contentType: crop?.contentType || extracted.contentType || 'image/jpeg',
        contentLength: extracted.buffer.length,
      },
    };
  }

  async function listRegionsWithCropStatus({ userId, shelfId, scanPhotoId }) {
    const scanPhoto = await scanPhotos.getByIdForUser({
      id: scanPhotoId,
      userId,
      shelfId,
    });
    if (!scanPhoto) {
      return {
        scanPhoto: null,
        scanPhotoId: Number(scanPhotoId) || null,
        regions: [],
      };
    }

    const regionRows = await regions.listForScan({
      userId,
      shelfId,
      scanPhotoId: scanPhoto.id,
    });

    let cropRows = [];
    try {
      cropRows = await crops.listForScan({
        userId,
        shelfId,
        scanPhotoId: scanPhoto.id,
      });
    } catch (err) {
      if (!isMissingRelationError(err, 'vision_item_crops')) {
        throw err;
      }
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[Vision] vision_item_crops table missing; returning regions without crop metadata.');
      }
    }

    const cropByRegionId = new Map(cropRows.map((crop) => [crop.regionId, crop]));
    const regionsWithCropStatus = regionRows.map((region) => {
      const crop = cropByRegionId.get(region.id);
      return {
        ...region,
        hasCrop: !!crop,
        cropImageUrl: buildCropUrl({
          shelfId,
          scanPhotoId: scanPhoto.id,
          regionId: region.id,
        }),
        cropContentType: crop?.contentType || null,
        cropWidth: crop?.width ?? null,
        cropHeight: crop?.height ?? null,
        cropCreatedAt: crop?.createdAt ?? null,
      };
    });

    return {
      scanPhoto,
      scanPhotoId: scanPhoto.id,
      regions: regionsWithCropStatus,
    };
  }

  async function getOrCreateRegionCrop({ userId, shelfId, shelfType = null, scanPhotoId, regionId }) {
    const scanPhoto = await scanPhotos.getByIdForUser({
      id: scanPhotoId,
      userId,
      shelfId,
    });
    if (!scanPhoto) {
      return {
        scanPhoto: null,
        region: null,
        crop: null,
        payload: null,
      };
    }

    const region = await regions.getByIdForScan({
      userId,
      shelfId,
      scanPhotoId: scanPhoto.id,
      regionId,
    });
    if (!region) {
      return {
        scanPhoto,
        region: null,
        crop: null,
        payload: null,
      };
    }

    return getOrCreateRegionCropFromEntities({
      userId,
      shelfId,
      shelfType,
      scanPhoto,
      region,
    });
  }

  async function warmScanCrops({ userId, shelfId, shelfType = null, scanPhotoId, jobId = null }) {
    if (!resolvedSettings.warmupEnabled || !scanPhotoId) {
      return { skipped: true, reason: 'disabled' };
    }

    try {
      const scanPhoto = await scanPhotos.getByIdForUser({
        id: scanPhotoId,
        userId,
        shelfId,
      });
      if (!scanPhoto) return { skipped: true, reason: 'missing_scan_photo' };

      const regionRows = await regions.listForScan({
        userId,
        shelfId,
        scanPhotoId: scanPhoto.id,
      });
      if (!regionRows.length) return { skipped: true, reason: 'no_regions' };

      let existingCrops = [];
      try {
        existingCrops = await crops.listForScan({
          userId,
          shelfId,
          scanPhotoId: scanPhoto.id,
        });
      } catch (err) {
        if (!isMissingRelationError(err, 'vision_item_crops')) {
          throw err;
        }
        if (logger && typeof logger.warn === 'function') {
          logger.warn('[Vision] vision_item_crops table missing; skipping crop warmup.');
        }
        return { skipped: true, reason: 'missing_crop_table' };
      }

      const existingByRegion = new Set(existingCrops.map((crop) => crop.regionId));
      const uncroppedTargets = regionRows.filter((region) => !existingByRegion.has(region.id));
      if (!uncroppedTargets.length) return { skipped: true, reason: 'already_warmed' };

      let warmupLimit = resolvedSettings.warmupMaxRegions;
      if (queue) {
        try {
          const [queueDepth, queueSettings] = await Promise.all([
            resolveQueueCount(queue, resolvedSettings),
            typeof queue.getSettings === 'function' ? queue.getSettings() : null,
          ]);
          if (Number.isFinite(queueDepth)) {
            const pressureThreshold = Math.max(
              Number(queueSettings?.workflowQueueLongThresholdPosition || 0),
              resolvedSettings.notifyForceLongPosition,
            );
            if (queueDepth >= pressureThreshold) {
              warmupLimit = Math.min(warmupLimit, resolvedSettings.warmupPressureMaxRegions);
            }
            if (queueDepth >= resolvedSettings.warmupDeferQueueDepth) {
              if (logger && typeof logger.info === 'function') {
                logger.info('[Vision] Skipping crop warmup under queue pressure', {
                  shelfId,
                  scanPhotoId: scanPhoto.id,
                  queueDepth,
                  threshold: resolvedSettings.warmupDeferQueueDepth,
                  jobId,
                });
              }
              return { skipped: true, reason: 'queue_pressure' };
            }
          }
        } catch (pressureErr) {
          if (logger && typeof logger.warn === 'function') {
            logger.warn('[Vision] Failed to evaluate queue pressure for crop warmup', {
              message: pressureErr?.message || String(pressureErr),
            });
          }
        }
      }

      const warmupTargets = uncroppedTargets.slice(0, warmupLimit);
      if (!warmupTargets.length) return { skipped: true, reason: 'limited_to_zero' };

      let generated = 0;
      let failed = 0;
      let scanImage = null;

      for (const region of warmupTargets) {
        try {
          const result = await extractVisionRegionCropPayload({
            userId,
            shelfId,
            scanPhoto,
            region,
            scanImage,
          });
          scanImage = result.scanImage || scanImage;
          await attachCropToCollectionItem({
            userId,
            shelfId,
            shelfType,
            region,
            crop: result.crop,
          });
          generated += 1;
        } catch (err) {
          failed += 1;
          if (logger && typeof logger.warn === 'function') {
            logger.warn('[Vision] Failed to warm crop for region', {
              scanPhotoId: scanPhoto.id,
              regionId: region.id,
              box2d: sanitizeBox2dForLog(getRegionBox2d(region)),
              message: err?.message || String(err),
            });
          }
        }
      }

      if (logger && typeof logger.info === 'function') {
        logger.info('[Vision] Crop warmup complete', {
          shelfId,
          scanPhotoId: scanPhoto.id,
          requested: warmupTargets.length,
          generated,
          failed,
          jobId,
        });
      }

      return {
        skipped: false,
        requested: warmupTargets.length,
        generated,
        failed,
      };
    } catch (err) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[Vision] Crop warmup failed', {
          shelfId,
          scanPhotoId,
          jobId,
          message: err?.message || String(err),
        });
      }
      throw err;
    }
  }

  async function restoreCropLinkageForReviewItem({
    userId,
    shelfId,
    shelfType = null,
    scanPhotoId,
    extractionIndex,
    collectableId = null,
    manualId = null,
    collectionItemId = null,
  }) {
    const scanPhoto = await scanPhotos.getByIdForUser({
      id: scanPhotoId,
      userId,
      shelfId,
    });
    if (!scanPhoto) {
      return { relinked: false, attachedCrop: false };
    }

    if (typeof regions.getByExtractionIndexForScan !== 'function') {
      return { relinked: false, attachedCrop: false };
    }

    const region = await regions.getByExtractionIndexForScan({
      userId,
      shelfId,
      scanPhotoId: scanPhoto.id,
      extractionIndex,
    });
    if (!region) {
      return { relinked: false, attachedCrop: false };
    }

    if (collectableId) {
      await regions.linkCollectable({
        scanPhotoId: scanPhoto.id,
        extractionIndex,
        collectableId,
      });
    }
    if (manualId) {
      await regions.linkManual({
        scanPhotoId: scanPhoto.id,
        extractionIndex,
        manualId,
      });
    }
    if (collectionItemId) {
      await regions.linkCollectionItem({
        scanPhotoId: scanPhoto.id,
        extractionIndex,
        collectionItemId,
      });
    }

    await getOrCreateRegionCropFromEntities({
      userId,
      shelfId,
      shelfType,
      scanPhoto,
      region: {
        ...region,
        scanPhotoId: scanPhoto.id,
        collectableId: collectableId || region.collectableId || null,
        manualId: manualId || region.manualId || null,
        collectionItemId: collectionItemId || region.collectionItemId || null,
      },
    });

    return {
      relinked: true,
      attachedCrop: true,
    };
  }

  return {
    listRegionsWithCropStatus,
    getOrCreateRegionCrop,
    warmScanCrops,
    restoreCropLinkageForReviewItem,
  };
}

module.exports = {
  createVisionCropService,
};
