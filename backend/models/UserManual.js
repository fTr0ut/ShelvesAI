const mongoose = require('mongoose');

// Manually entered items by a user for a specific shelf
const UserManualSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    shelf: { type: mongoose.Schema.Types.ObjectId, ref: 'Shelf', index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, trim: true },
    description: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserManual', UserManualSchema);

