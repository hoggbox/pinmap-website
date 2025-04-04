const express = require('express');
const router = express.Router();
const TrafficCamera = require('../models/trafficCamera');

// Get all traffic cameras
router.get('/', async (req, res) => {
  try {
    const cameras = await TrafficCamera.find();
    res.json(cameras);
  } catch (err) {
    console.error('Error fetching traffic cameras:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
