const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Pin, Comment } = require('../models/pin');
const User = require('../models/user');
const authenticate = require('../middleware/authenticate');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Only images (jpeg, jpg, png, gif) are allowed'));
  },
});

async function removeExpiredPins() {
  try {
    const now = new Date();
    await Pin.deleteMany({ expiresAt: { $lt: now } });
    console.log('Expired pins removed');
  } catch (err) {
    console.error('Error removing expired pins:', err);
  }
}
setInterval(removeExpiredPins, 60 * 60 * 1000);

// Get all pins
router.get('/', authenticate, async (req, res) => {
  try {
    await removeExpiredPins();
    const pins = await Pin.find()
      .populate('userId', 'email username location role')
      .populate({
        path: 'comments',
        populate: { path: 'replies', populate: { path: 'replies' } },
      });
    res.json(pins.length ? pins : []);
  } catch (err) {
    console.error('Error fetching pins:', err);
    res.status(500).json({ message: 'Server error fetching pins', error: err.message });
  }
});

// Add a pin
router.post('/', authenticate, upload.single('media'), async (req, res) => {
  try {
    const { latitude, longitude, description, expiresInHours } = req.body;
    if (!latitude || !longitude || !description) {
      return res.status(400).json({ message: 'Latitude, longitude, and description are required' });
    }
    const media = req.file ? `/uploads/${req.file.filename}` : null;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const expiresAt = expiresInHours ? new Date(Date.now() + parseInt(expiresInHours) * 60 * 60 * 1000) : new Date(Date.now() + 2 * 60 * 60 * 1000);
    const pin = new Pin({
      userId: req.user.id,
      userEmail: user.email,
      username: user.username || null,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      description: description.trim(),
      media,
      expiresAt
    });
    await pin.save();

    user.totalPins += 1;
    user.activityLogs.push({ action: 'Posted pin', details: pin._id.toString() });
    if (user.totalPins >= 10 && !user.badges.includes('10_Pins')) {
      user.badges.push('10_Pins');
    }
    await user.save();

    const populatedPin = await Pin.findById(pin._id).populate('userId', 'email username location role');
    res.status(201).json(populatedPin);
  } catch (err) {
    console.error('Error adding pin:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Extend pin expiration
router.put('/extend/:id', authenticate, async (req, res) => {
  try {
    const pin = await Pin.findById(req.params.id);
    if (!pin) return res.status(404).json({ message: 'Pin not found' });
    const user = await User.findById(req.user.id);
    if (pin.userId.toString() !== req.user.id && user.role !== 'admin' && user.role !== 'moderator') {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    pin.expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await pin.save();
    res.json(pin);
  } catch (err) {
    console.error('Error extending pin:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Verify a pin
router.post('/verify/:id', authenticate, async (req, res) => {
  try {
    const pin = await Pin.findById(req.params.id);
    if (!pin) return res.status(404).json({ message: 'Pin not found' });
    if (pin.verifications.includes(req.user.id)) {
      return res.status(400).json({ message: 'You have already verified this pin' });
    }
    pin.verifications.push(req.user.id);
    if (pin.verifications.length >= 3) pin.verified = true;
    await pin.save();

    const user = await User.findById(req.user.id);
    user.activityLogs.push({ action: 'Verified pin', details: pin._id.toString() });
    const verifiedPins = await Pin.countDocuments({ verifications: req.user.id });
    if (verifiedPins >= 5 && !user.badges.includes('5_Verifications')) {
      user.badges.push('5_Verifications');
    }
    await user.save();

    res.json({ verifications: pin.verifications.length, verified: pin.verified });
  } catch (err) {
    console.error('Error verifying pin:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get comments for a pin
router.get('/comments/:id', authenticate, async (req, res) => {
  try {
    const pin = await Pin.findById(req.params.id).populate({
      path: 'comments',
      populate: [
        { path: 'userId', select: 'username email' },
        { path: 'replies', populate: { path: 'userId', select: 'username email' } },
      ],
    });
    if (!pin) return res.status(404).json({ message: 'Pin not found' });
    res.json(pin.comments);
  } catch (err) {
    console.error('Error fetching comments:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Add comment to pin
router.post('/comment/:id', authenticate, async (req, res) => {
  try {
    const { content, parentCommentId } = req.body;
    if (!content || content.trim() === '') {
      return res.status(400).json({ message: 'Comment content cannot be empty' });
    }
    const pin = await Pin.findById(req.params.id);
    if (!pin) return res.status(404).json({ message: 'Pin not found' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const comment = new Comment({
      userId: req.user.id,
      username: user.username || user.email,
      content: content.trim(),
      timestamp: new Date(),
    });

    if (parentCommentId) {
      const parentComment = await Comment.findById(parentCommentId);
      if (!parentComment) return res.status(404).json({ message: 'Parent comment not found' });
      parentComment.replies.push(comment);
      await parentComment.save();
    } else {
      pin.comments.push(comment);
      await pin.save();
    }

    await comment.save();
    const populatedComment = await Comment.findById(comment._id)
      .populate('userId', 'username email')
      .populate({ path: 'replies', populate: { path: 'userId', select: 'username email' } });
    res.status(201).json(populatedComment);
  } catch (err) {
    console.error('Error adding comment:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Like a comment
router.post('/comment/:commentId/like', authenticate, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    if (comment.likes.includes(req.user.id)) {
      return res.status(400).json({ message: 'You already liked this comment' });
    }
    if (comment.dislikes.includes(req.user.id)) {
      comment.dislikes = comment.dislikes.filter((id) => id.toString() !== req.user.id);
    }
    comment.likes.push(req.user.id);
    await comment.save();
    res.json({ likes: comment.likes.length, dislikes: comment.dislikes.length });
  } catch (err) {
    console.error('Error liking comment:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Dislike a comment
router.post('/comment/:commentId/dislike', authenticate, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    if (comment.dislikes.includes(req.user.id)) {
      return res.status(400).json({ message: 'You already disliked this comment' });
    }
    if (comment.likes.includes(req.user.id)) {
      comment.likes = comment.likes.filter((id) => id.toString() !== req.user.id);
    }
    comment.dislikes.push(req.user.id);
    await comment.save();
    res.json({ likes: comment.likes.length, dislikes: comment.dislikes.length });
  } catch (err) {
    console.error('Error disliking comment:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Vote to remove a pin
router.post('/vote/:id', authenticate, async (req, res) => {
  try {
    const pin = await Pin.findById(req.params.id);
    if (!pin) return res.status(404).json({ message: 'Pin not found' });
    if (pin.voters.includes(req.user.id)) {
      return res.status(400).json({ message: 'You have already voted' });
    }
    pin.voters.push(req.user.id);
    pin.voteCount += 1;
    if (pin.voteCount >= 8) {
      await Pin.findByIdAndDelete(req.params.id);
      return res.json({ removed: true, message: 'Pin removed due to votes' });
    }
    await pin.save();
    const user = await User.findById(req.user.id);
    user.activityLogs.push({ action: 'Voted to remove pin', details: pin._id.toString() });
    await user.save();
    res.json({ voteCount: pin.voteCount });
  } catch (err) {
    console.error('Error voting on pin:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Delete a pin
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const pin = await Pin.findById(req.params.id);
    if (!pin) return res.status(404).json({ message: 'Pin not found' });
    const user = await User.findById(req.user.id);
    if (pin.userId.toString() !== req.user.id && user.role !== 'admin' && user.role !== 'moderator') {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    await Pin.findByIdAndDelete(req.params.id);
    res.json({ message: 'Pin deleted' });
  } catch (err) {
    console.error('Error deleting pin:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
