const mongoose = require('mongoose');

// Join table linking a user's shelf to either a catalog collectable or a manual item
const UserCollectionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    shelf: { type: mongoose.Schema.Types.ObjectId, ref: 'Shelf', index: true },
    collectable: { type: mongoose.Schema.Types.ObjectId, ref: 'Collectable' },
    manual: { type: mongoose.Schema.Types.ObjectId, ref: 'UserManual' },
  },
  { timestamps: true }
);

UserCollectionSchema.index({ user: 1, shelf: 1 });

module.exports = mongoose.model('UserCollection', UserCollectionSchema);

