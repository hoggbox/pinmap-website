const express = require('express');
const Message = require('../models/message');
const authenticateToken = require('../middleware/authenticate');

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const messages = await Message.find({ recipient: req.user.id })
      .populate('sender', 'username email')
      .sort({ timestamp: -1 });
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Server error fetching messages' });
  }
});

router.get('/unread', authenticateToken, async (req, res) => {
  try {
    const unreadCount = await Message.countDocuments({ recipient: req.user.id, read: false });
    res.json(unreadCount);
  } catch (err) {
    console.error('Error fetching unread count:', err);
    res.status(500).json({ message: 'Server error fetching unread count' });
  }
});

module.exports = router;
