const mongoose = require('mongoose');

const trafficCameraSchema = new mongoose.Schema({
  cameraId: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  imageUrl: { type: String }, // URL to live feed or snapshot
  lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TrafficCamera', trafficCameraSchema);
