const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const pinRoutes = require('./routes/pins');
const path = require('path');
const WebSocket = require('ws');
const Chat = require('./models/chat');
const User = require('./models/user');
const Message = require('./models/message');
const BannedIP = require('./models/bannedIp');

dotenv.config();
const app = express();

// Middleware
app.use(cors({
  origin: 'https://frontend-a966.onrender.com', // Restrict to frontend URL
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/auth', authRoutes);
app.use('/pins', pinRoutes);

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected:', mongoose.connection.name))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// User Location Schema
const locationSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  email: { type: String, required: true },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  timestamp: { type: Date, default: Date.now },
});
locationSchema.index({ location: '2dsphere' });
const Location = mongoose.model('Location', locationSchema);

// WebSocket Server
const server = app.listen(process.env.PORT || 5000, () => console.log(`Server running on port ${process.env.PORT || 5000}`));
const wss = new WebSocket.Server({ server });
app.wss = wss; // Attach wss to app for use in routes
const adminEmail = 'imhoggbox@gmail.com';
const onlineUsers = new Map();

wss.on('connection', (ws, req) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (!ws.userId || !ws.email) {
        if (data.type === 'auth' && data.userId && data.email) {
          ws.userId = data.userId;
          ws.email = data.email;
          console.log(`WebSocket authenticated: ${ws.email}, ${ws.userId}`);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
          return;
        }
      }

      if (data.type === 'location') {
        const { userId, email, latitude, longitude } = data;
        await Location.findOneAndUpdate(
          { userId },
          {
            email,
            location: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
            timestamp: new Date()
          },
          { upsert: true, new: true }
        );
        onlineUsers.set(userId, { ws, email, latitude, longitude, timestamp: new Date() });

        wss.clients.forEach(async (client) => {
          if (client.readyState === WebSocket.OPEN) {
            if (client.email === adminEmail) {
              const allLocations = await Location.find();
              client.send(JSON.stringify({
                type: 'allLocations',
                locations: allLocations.map(loc => ({
                  userId: loc.userId,
                  email: loc.email,
                  latitude: loc.location.coordinates[1],
                  longitude: loc.location.coordinates[0]
                }))
              }));
              const onlineUsersData = Array.from(onlineUsers.entries()).map(([userId, info]) => ({
                userId,
                email: info.email,
                latitude: info.latitude,
                longitude: info.longitude,
                timestamp: info.timestamp
              }));
              client.send(JSON.stringify({ type: 'onlineUsers', users: onlineUsersData }));
            } else if (client.email === email && client.userId === userId) {
              client.send(JSON.stringify({ type: 'location', userId, email, latitude, longitude }));
            }
          }
        });
      } else if (data.type === 'chat') {
        const { userId, username, message } = data;
        const chatMessage = new Chat({ userId, username, message });
        await chatMessage.save();
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'chat',
              userId,
              username,
              message,
              timestamp: chatMessage.timestamp
            }));
          }
        });
      } else if (data.type === 'privateMessage') {
        const { senderId, recipientId, content } = data;
        const messageDoc = new Message({ senderId, recipientId, content });
        await messageDoc.save();
        const populatedMessage = await Message.findById(messageDoc._id)
          .populate('senderId', 'username email')
          .populate('recipientId', 'username email');
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && (client.userId === recipientId || client.userId === senderId)) {
            client.send(JSON.stringify({
              type: 'privateMessage',
              message: populatedMessage
            }));
          }
        });
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'WebSocket processing error' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    for (const [userId, info] of onlineUsers) {
      if (info.ws === ws) {
        onlineUsers.delete(userId);
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && client.email === adminEmail) {
            const onlineUsersData = Array.from(onlineUsers.entries()).map(([userId, info]) => ({
              userId,
              email: info.email,
              latitude: info.latitude,
              longitude: info.longitude,
              timestamp: info.timestamp
            }));
            client.send(JSON.stringify({ type: 'onlineUsers', users: onlineUsersData }));
          }
        });
        break;
      }
    }
  });
});

// Set WebSocket email (for frontend compatibility)
app.get('/set-ws-email', (req, res) => {
  const { email, userId } = req.query;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && (!client.userId || !client.email)) {
      client.userId = userId;
      client.email = email;
      client.send(JSON.stringify({ type: 'authSuccess' }));
    }
  });
  res.send('WebSocket email set');
});

// Weather endpoint (stubbed as not modified)
app.get('/weather', (req, res) => {
  res.json({ alerts: [] }); // Placeholder as original not provided
});

// Admin Analytics Endpoint
const { Pin } = require('./models/pin');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).send('No token provided');
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).send('Invalid token');
    req.user = user;
    next();
  });
}

app.get('/admin/analytics', authenticateToken, async (req, res) => {
  if (req.user.email !== adminEmail) return res.status(403).send('Admin only');
  try {
    const totalPins = await Pin.countDocuments();
    const activeUsers = await User.countDocuments();
    const pinTypes = await Pin.aggregate([
      { $group: { _id: '$description', count: { $sum: 1 } } },
      { $project: { type: '$_id', count: 1, _id: 0 } }
    ]);
    const topUsers = await User.find().sort({ totalPins: -1 }).limit(5).select('username email totalPins');
    res.json({ totalPins, activeUsers, pinTypes, topUsers });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).send('Server error');
  }
});
