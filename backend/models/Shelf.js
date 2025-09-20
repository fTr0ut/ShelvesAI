const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema(
  {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
  { _id: false }
);

const ShelfSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    visibility: { type: String, enum: ['private', 'friends', 'public'], default: 'private' },
    position: { type: positionSchema, default: () => ({ x: 0, y: 0 }) },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Shelf', ShelfSchema);
