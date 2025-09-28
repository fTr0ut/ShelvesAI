const mongoose = require('mongoose');

function categorizeUsername(value) {
  if (!value) return undefined;
  const first = value[0];
  if (first >= 'a' && first <= 'z') return first;
  if (first >= '0' && first <= '9') return '#';
  return '*';
}

function buildSearchTokens(source) {
  const tokens = new Set();
  const push = (token) => {
    if (!token) return;
    const trimmed = token.trim();
    if (trimmed) tokens.add(trimmed);
  };

  const ingest = (value) => {
    if (!value) return;
    const str = String(value).toLowerCase();
    push(str);
    str.split(/[^a-z0-9]+/).forEach((piece) => {
      if (piece) push(piece);
    });
  };

  ingest(source.username);
  ingest(source.name);
  ingest(source.firstName);
  ingest(source.lastName);
  ingest(source.email);

  // Include combined name tokens if both first/last provided
  if (source.firstName || source.lastName) {
    const full = [source.firstName, source.lastName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    ingest(full);
  }

  return Array.from(tokens).slice(0, 40);
}

const SteamAccountSchema = new mongoose.Schema(
  {
    steamId: { type: String, trim: true },
    personaName: { type: String, trim: true },
    profileUrl: { type: String, trim: true },
    avatar: { type: String, trim: true },
    avatarMedium: { type: String, trim: true },
    avatarFull: { type: String, trim: true },
    countryCode: { type: String, trim: true },
    visibilityState: { type: Number },
    visibility: { type: String, trim: true },
    linkedAt: { type: Date },
    lastSyncedAt: { type: Date },
    lastImportedAt: { type: Date },
    totalGames: { type: Number },
    lastShelfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shelf' },
    optedIntoLibrarySync: { type: Boolean, default: true },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    // App username: required for local accounts; optional for Auth0-first accounts (set later)
    username: { type: String, unique: true, sparse: true, trim: true },
    usernameLower: { type: String, lowercase: true, trim: true },
    usernameCategory: { type: String, trim: true, maxlength: 1 },
    searchTokens: { type: [String], default: [] },
    // Local password hash (bcrypt). Optional when using Auth0.
    password: { type: String },
    // Auth0 subject (e.g., "auth0|abc123"). Optional; unique sparse for linking.
    auth0Sub: { type: String, unique: true, sparse: true },
    // Contact/profile
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    name: { type: String },
    picture: { type: String },
    // Optional profile fields per data sheet
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    phoneNumber: { type: String, trim: true },
    country: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    isPrivate: { type: Boolean, default: false },
    steam: { type: SteamAccountSchema, default: undefined },
  },
  { timestamps: true }
);

UserSchema.index({ usernameLower: 1 });
UserSchema.index({ usernameCategory: 1, usernameLower: 1 });
UserSchema.index({ searchTokens: 1 });
UserSchema.index({ 'steam.steamId': 1 }, { unique: true, sparse: true });

UserSchema.methods.refreshSearchMetadata = function refreshSearchMetadata() {
  const usernameLower = this.username ? String(this.username).toLowerCase().trim() : undefined;
  this.usernameLower = usernameLower || undefined;
  this.usernameCategory = categorizeUsername(usernameLower);
  this.searchTokens = buildSearchTokens({
    username: this.username,
    name: this.name,
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
  });
};

UserSchema.pre('save', function saveHook(next) {
  this.refreshSearchMetadata();
  next();
});

module.exports = mongoose.model('User', UserSchema);
