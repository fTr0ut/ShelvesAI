const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    coordinates: {
      x: { type: Number, min: 0, max: 1 },
      y: { type: Number, min: 0, max: 1 },
    },
  },
  { _id: false },
);

// Join table linking a user's shelf to either a catalog collectable or a manual item
const UserCollectionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    shelf: { type: mongoose.Schema.Types.ObjectId, ref: 'Shelf', index: true },
    collectable: { type: mongoose.Schema.Types.ObjectId, ref: 'Collectable' },
    manual: { type: mongoose.Schema.Types.ObjectId, ref: 'UserManual' },
    position: { type: positionSchema, default: undefined },
    notes: { type: String, trim: true },
    rating: { type: Number, min: 0, max: 5 },
  },
  { timestamps: true },
);

UserCollectionSchema.index({ user: 1, shelf: 1 });

module.exports = mongoose.model('UserCollection', UserCollectionSchema);
