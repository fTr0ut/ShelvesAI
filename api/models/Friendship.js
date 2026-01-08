const mongoose = require('mongoose');

const FriendshipSchema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    addressee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'accepted', 'blocked'], default: 'pending', index: true },
    message: { type: String, trim: true },
  },
  { timestamps: true }
);

FriendshipSchema.index({ requester: 1, addressee: 1 }, { unique: true });

module.exports = mongoose.model('Friendship', FriendshipSchema);

