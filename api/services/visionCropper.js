const visionCrops = require('@shelvesai/vision-crops');
const logger = require('../logger');

module.exports = {
  ...visionCrops,
  extractRegionCrop(options = {}) {
    return visionCrops.extractRegionCrop({
      ...options,
      logger: options.logger || logger,
    });
  },
};
