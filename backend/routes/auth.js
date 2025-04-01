const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const User = require('../models/user');
const authenticateToken = require('../middleware/authenticate');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

router.post('/register', upload.single('profilePicture'), async (req, res) => {
  const { email, password, username, birthdate, sex, location } = req.body;
  const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      email,
      password: hashedPassword,
      username,
      birthdate,
      sex,
      location,
      profilePicture
    });
    await user.save();
    res.status(201).json({ success: true, message: 'User registered successfully' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password, _

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/profile', authenticateToken, upload.single('profilePicture'), async (req, res) => {
  const { username, birthdate, sex, location } = req.body;
  const profilePicture = req.file ? `/uploads/${req.file.filename}` : undefined;

  try {
    const updateData = {};
    if (username) updateData.username = username;
    if (birthdate) updateData.birthdate = birthdate;
    if (sex) updateData.sex = sex;
    if (location) updateData.location = location;
    if (profilePicture) updateData.profilePicture = profilePicture;

    const user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/profile/:userId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      ...user.toObject(),
      pinCount: await Pin.countDocuments({ userId: req.params.userId }),
      reputation: user.reputation || 0,
      badges: user.badges || []
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/profile/:userId/upvote', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.upvotes.includes(req.user.id)) return res.status(400).json({ message: 'Already upvoted' });
    user.upvotes.push(req.user.id);
    user.reputation = (user.reputation || 0) + 1;
    await user.save();
    res.json({ message: 'Upvoted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/profile/:userId/downvote', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.downvotes.includes(req.user.id)) return res.status(400).json({ message: 'Already downvoted' });
    user.downvotes.push(req.user.id);
    user.reputation = (user.reputation || 0) - 1;
    await user.save();
    res.json({ message: 'Downvoted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/profile/:userId/message', authenticateToken, async (req, res) => {
  const { content } = req.body;
  try {
    const message = new Message({
      sender: req.user.id,
      recipient: req.params.userId,
      content
    });
    await message.save();
    res.status(201).json({ message: 'Message sent' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/location', authenticateToken, async (req, res) => {
  const { latitude, longitude } = req.body;
  try {
    const user = await User.findByIdAndUpdate(req.user.id, { latitude, longitude }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
