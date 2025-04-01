const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Message = require('../models/message');
const BannedIp = require('./models/bannedIp');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Increased file size limit to 10MB
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb('Error: Images only (jpeg, jpg, png, gif)!');
    },
});

const authMiddleware = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

const adminMiddleware = (req, res, next) => {
    if (req.user.email !== 'imhoggbox@gmail.com') {
        return res.status(403).json({ message: 'Admin access only' });
    }
    next();
};

// Register
router.post('/register', upload.single('profilePicture'), async (req, res) => {
    const { email, password, username, birthdate, sex, location } = req.body;

    try {
        // Check if the user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create the new user
        const user = new User({
            email,
            password: hashedPassword,
            username,
            birthdate: birth.birthday,
            sex,
            location,
            profilePicture: req.file ? `/uploads/${req.file.filename}` : undefined,
        });

        // Save the user to the database
        await user.save();

        // Respond with a success message
        res.status(201).json({ message: 'User registered successfully' });
    } catch (err) {
        console.error('Register error:', err);
        if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
            return res.status(400).json({ message: 'Email already exists' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { email, password, stayLoggedIn } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        if (user.isBanned) return res.status(403).json({ message: 'Account is banned' });
        user.lastLogin = new Date();
        user.ipAddress = req.ip;
        const daysActive = Math.floor((new Date() - new Date(user.joinDate)) / (1000 * 60 * 60 * 24));
        if (daysActive >= 30 && !user.badges.includes('30_Days_Active')) {
            user.badges.push('30_Days_Active');
        }
        await user.save();
        const expiresIn = stayLoggedIn ? '30d' : '1h';
        const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn });
        res.json({ token });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get Profile
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) {
        console.error('Profile error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update Profile
router.put('/profile', authMiddleware, upload.single('profilePicture'), async (req, res) => {
    const { username, birthdate, sex, location } = req.body;
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (username) user.username = username;
        if (birthdate) user.birthdate = birthdate;
        if (sex) user.sex = sex;
        if (location) user.location = location;
        if (req.file) user.profilePicture = `/uploads/${req.file.filename}`;
        await user.save();
        res.json(user);
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get User Profile by ID
router.get('/profile/:id', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update Current Location
router.put('/location', authMiddleware, async (req, res) => {
    const { latitude, longitude } = req.body;
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        user.currentLatitude = latitude;
        user.currentLongitude = longitude;
        await user.save();
        res.json({ message: 'Location updated', latitude, longitude });
    } catch (err) {
        console.error('Update location error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get Inbox Messages
router.get('/messages', authMiddleware, async (req, res) => {
    try {
        // Retrieve messages where the user is the recipient
        const messages = await Message.find({ recipientId: req.user.id })
            .populate('senderId', 'username email') // Populate sender information
            .sort({ timestamp: -1 }); // Sort by timestamp, newest first

        res.json(messages);
    } catch (err) {
        console.error('Get inbox messages error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Upvote User
router.post('/upvote/:id', authMiddleware, async (req, res) => {
    try {
        const userToUpvote = await User.findById(req.params.id);
        if (!userToUpvote) return res.status(404).json({ message: 'User not found' });
        if (req.user.id === req.params.id) return res.status(400).json({ message: 'Cannot upvote yourself' });

        userToUpvote.upvotes += 1;
        userToUpvote.reputation += 1;
        await userToUpvote.save();

        const upvoter = await User.findById(req.user.id);
        upvoter.activityLogs.push({ action: 'Upvoted user', details: userToUpvote.email });
        await upvoter.save();

        res.json({ upvotes: userToUpvote.upvotes, reputation: userToUpvote.reputation });
    } catch (err) {
        console.error('Upvote error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Downvote User
router.post('/downvote/:id', authMiddleware, async (req, res) => {
    try {
        const userToDownvote = await User.findById(req.params.id);
        if (!userToDownvote) return res.status(404).json({ message: 'User not found' });
        if (req.user.id === req.params.id) return res.status(400).json({ message: 'Cannot downvote yourself' });

        userToDownvote.downvotes += 1;
        userToDownvote.reputation -= 1;
        await userToDownvote.save();

        const downvoter = await User.findById(req.user.id);
        downvoter.activityLogs.push({ action: 'Downvoted user', details: userToDownvote.email });
        await user.save();

        res.json({ downvotes: userToDownvote.downvotes, reputation: userToDownvote.reputation });
    } catch (err) {
        console.error('Downvote error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get All Users (Admin Only)
router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json(users);
    } catch (err) {
        console.error('Fetch users error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get User Activity Logs (Admin Only)
router.get('/activity/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user.activityLogs);
    } catch (err) {
        console.error('Fetch activity logs error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Bulk Delete Users (Admin Only)
router.post('/users/bulk-delete', authMiddleware, adminMiddleware, async (req, res) => {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: 'No user IDs provided' });
    }
    try {
        const result = await User.deleteMany({ _id: { $in: userIds } });
        res.json({ message: `${result.deletedCount} user(s) deleted` });
    } catch (err) {
        console.error('Bulk delete error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Ban IPs (Admin Only)
router.post('/ban-ip', authMiddleware, adminMiddleware, async (req, res) => {
    const { ipAddresses } = req.body;
    if (!Array.isArray(ipAddresses) || ipAddresses.length === 0) {
        return res.status(400).json({ message: 'No IP addresses provided' });
    }
    try {
        const result = await User.updateMany(
            { ipAddress: { $in: ipAddresses } },
            { $set: { isBanned: true } }
        );
        await BannedIp.findOneAndUpdate(
            { ipAddress: ip },
            { ipAddress: ip, adminId: req.user.id, reason: 'Admin ban' },
            { upsert: true }
        );
        res.json({ message: `${result.modifiedCount} user(s) banned` });
    } catch (err) {
        console.error('Ban IP error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Unban IPs (Admin Only)
router.post('/unban-ip', authMiddleware, adminMiddleware, async (req, res) => {
    const { ipAddresses } = req.body;
    if (!Array.isArray(ipAddresses) || ipAddresses.length === 0) {
        return res.status(400).json({ message: 'No IP addresses provided' });
    }
    try {
        const result = await User.updateMany(
            { ipAddress: { $in: ipAddresses } },
            { $set: { isBanned: false } }
        );
        await BannedIp.updateMany(
            { ipAddress: { $in: ipAddresses } },
            { $set: { unbannedAt: new Date() } }
        );
        res.json({ message: `${result.modifiedCount} user(s) unbanned` });
    } catch (err) {
        console.error('Unban IP error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get IP Ban History (Admin Only)
router.get('/ip-ban-history', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const bans = await BannedIp.find().populate('adminId', 'email');
        res.json(bans);
    } catch (err) {
        console.error('Fetch IP ban history error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Endpoint for unread message count
router.get('/messages/unread', authMiddleware, async (req, res) => {
    try {
        const count = await Message.countDocuments({
            recipientId: req.user.id,
            read: false
        });
        res.json(count);
    } catch (err) {
        console.error('Get unread count error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;

