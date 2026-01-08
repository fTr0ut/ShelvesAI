const mongoose = require('mongoose');

const Auth0ProfileSchema = new mongoose.Schema(
  {
    sub: { type: String, required: true, unique: true },
    email: { type: String },
    name: { type: String },
    picture: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Auth0Profile', Auth0ProfileSchema);

