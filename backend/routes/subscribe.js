// routes/subscribe.js
const express = require('express');
const router = express.Router();
const Subscription = require('../models/subscription');
const authenticate = require('../middleware/authenticate');

router.post('/', authenticate, async (req, res) => {
  try {
    const subscription = new Subscription({
      userId: req.user.id,
      endpoint: req.body.endpoint,
      keys: req.body.keys
    });
    await subscription.save();
    res.status(201).json({ message: 'Subscription saved' });
  } catch (err) {
    console.error('Error saving subscription:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
