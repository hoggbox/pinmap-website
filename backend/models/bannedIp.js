const mongoose = require('mongoose');
const bannedIpSchema = new mongoose.Schema({
  ipAddress: { type: String, required: true },
  bannedAt: { type: Date, default: Date.now },
  unbannedAt: { type: Date },
  reason: String,
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});
module.exports = mongoose.model('BannedIP', bannedIpSchema);
