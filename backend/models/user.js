const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const activityLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  details: { type: String }
});

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  username: { type: String },
  birthdate: { type: Date },
  sex: { type: String },
  location: { type: String },
  profilePicture: { type: String },
  usernameChanges: { type: Number, default: 0 },
  ipAddress: { type: String },
  joinDate: { type: Date, default: Date.now },
  isBanned: { type: Boolean, default: false },
  lastLogin: { type: Date },
  reputation: { type: Number, default: 0 },
  upvotes: { type: Number, default: 0 },
  downvotes: { type: Number, default: 0 },
  currentLatitude: { type: Number },
  currentLongitude: { type: Number },
  totalPins: { type: Number, default: 0 },
  badges: [{ type: String }],
  messages: [messageSchema],
  activityLogs: [activityLogSchema],
  role: { type: String, default: 'user', enum: ['user', 'moderator', 'admin'] }, // New role field
  mutedUntil: { type: Date, default: null } // For chat moderation
});

module.exports = mongoose.model('User', userSchema);
