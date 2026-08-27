import mongoose from 'mongoose';

/**
 * A CodeWeave user is always a GitHub identity. GitHub user-to-server tokens are
 * stored encrypted (AES-256-GCM) and never leave the server.
 */
const userSchema = new mongoose.Schema(
  {
    githubId: { type: Number, required: true, unique: true, index: true },
    login: { type: String, required: true, index: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    profileUrl: { type: String, default: '' },

    // Encrypted GitHub user-to-server credentials
    accessTokenEnc: { type: String, default: '', select: false },
    accessTokenExpiresAt: { type: Date, default: null },
    refreshTokenEnc: { type: String, default: '', select: false },
    refreshTokenExpiresAt: { type: Date, default: null },
    tokenScopes: { type: [String], default: [] },

    // GitHub App installations this user can act through
    installationIds: { type: [Number], default: [] },

    lastLoginAt: { type: Date, default: Date.now },
    preferences: {
      theme: { type: String, enum: ['dark', 'light'], default: 'dark' },
    },
  },
  { timestamps: true },
);

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    githubId: this.githubId,
    login: this.login,
    name: this.name,
    avatarUrl: this.avatarUrl,
    profileUrl: this.profileUrl,
    installationIds: this.installationIds,
    preferences: { theme: this.preferences?.theme ?? 'dark' },
    createdAt: this.createdAt,
  };
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);
