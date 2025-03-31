const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Users who liked
  dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Users who disliked
  replies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }] // Nested replies
});

const pinSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userEmail: { type: String, required: true },
  username: { type: String },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  description: { type: String, required: true },
  media: { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 2 * 60 * 60 * 1000) }, // Default 2 hours
  voteCount: { type: Number, default: 0 },
  voters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  verifications: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  verified: { type: Boolean, default: false },
  comments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }] // Reference comments instead of embedding
});

// Define Comment model separately
const Comment = mongoose.model('Comment', commentSchema);
const Pin = mongoose.model('Pin', pinSchema);

module.exports = { Pin, Comment };