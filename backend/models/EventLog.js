const mongoose = require('mongoose');

const EventLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shelf: { type: mongoose.Schema.Types.ObjectId, ref: 'Shelf', required: true, index: true },
    type: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

EventLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('EventLog', EventLogSchema);
