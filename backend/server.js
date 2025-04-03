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
const fs = require('fs');
const jwt = require('jsonwebtoken');
const webPush = require('web-push');

dotenv.config();
const app = express();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Push Notification Setup
webPush.setVapidDetails(
  'mailto:imhoggbox@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://frontend-a966.onrender.com',
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use('/auth', authRoutes);
app.use('/pins', pinRoutes);

// MongoDB Connection with Reconnection Logic
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected:', mongoose.connection.name);
  } catch (err) {
    console.error('MongoDB connection error:', err);
    setTimeout(connectDB, 5000);
  }
};
connectDB();

// User Location Schema
const locationSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  email: { type: String, required: true },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  timestamp: { type: Date, default: Date.now },
});
locationSchema.index({ location: '2dsphere' });
const Location = mongoose.model('Location', locationSchema);

// Subscription storage (in-memory for now, use DB in prod)
const subscriptions = new Map();

// WebSocket Server
const server = app.listen(process.env.PORT || 5000, () =>
  console.log(`Server running on port ${process.env.PORT || 5000}`)
);
const wss = new WebSocket.Server({ server });
const adminEmail = 'imhoggbox@gmail.com';
const onlineUsers = new Map();

wss.on('connection', (ws, req) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (!ws.userId || !ws.email) {
        if (data.type === 'auth' && data.userId && data.email && data.token) {
          const decoded = jwt.verify(data.token, process.env.JWT_SECRET || 'your-secret-key');
          if (decoded.id === data.userId && decoded.email === data.email) {
            ws.userId = data.userId;
            ws.email = data.email;
            console.log(`WebSocket authenticated: ${ws.email}, ${ws.userId}`);
            onlineUsers.set(ws.userId, { ws, email: ws.email, latitude: null, longitude: null, timestamp: new Date() });
            broadcastOnlineUsers();
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid authentication' }));
            ws.close();
            return;
          }
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication required with token' }));
          return;
        }
      }

      if (data.type === 'location') {
        const { userId, email, latitude, longitude } = data;
        if (!latitude || !longitude) throw new Error('Missing coordinates');
        await Location.findOneAndUpdate(
          { userId },
          {
            email,
            location: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
            timestamp: new Date(),
          },
          { upsert: true, new: true }
        );
        onlineUsers.set(userId, { ws, email, latitude, longitude, timestamp: new Date() });
        broadcastOnlineUsers();

        wss.clients.forEach(async (client) => {
          if (client.readyState === WebSocket.OPEN) {
            if (client.email === adminEmail) {
              const allLocations = await Location.find();
              client.send(
                JSON.stringify({
                  type: 'allLocations',
                  locations: allLocations.map((loc) => ({
                    userId: loc.userId,
                    email: loc.email,
                    latitude: loc.location.coordinates[1],
                    longitude: loc.location.coordinates[0],
                  })),
                })
              );
            } else if (client.email === email && client.userId === userId) {
              client.send(JSON.stringify({ type: 'location', userId, email, latitude, longitude }));
            }
          }
        });
      } else if (data.type === 'chat') {
        const { userId, username, message } = data;
        if (!message.trim()) throw new Error('Message cannot be empty');
        const user = await User.findById(userId);
        if (user.mutedUntil && new Date() < user.mutedUntil) throw new Error('User is muted');
        const chatMessage = new Chat({ userId, username, message });
        await chatMessage.save();
        broadcastChatMessage(chatMessage);
      } else if (data.type === 'privateMessage') {
        const { senderId, recipientId, content } = data;
        if (!content.trim()) throw new Error('Message content cannot be empty');
        const messageDoc = new Message({ senderId, recipientId, content });
        await messageDoc.save();
        const recipientWs = Array.from(onlineUsers.values()).find((u) => u.ws.userId === recipientId)?.ws;
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          recipientWs.send(JSON.stringify({ type: 'privateMessage', senderId, recipientId, content }));
        }
        sendPushNotification(recipientId, `New message from ${username || senderId}`);
      } else if (data.type === 'newPin') {
        const { pin } = data;
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'newPin', pin }));
            sendPushNotification(client.userId, `New pin: ${pin.description}`);
          }
        });
      } else if (data.type === 'newComment') {
        const { pinId } = data;
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'newComment', pinId }));
          }
        });
      } else if (data.type === 'muteUser') {
        const { targetId, duration } = data;
        const user = await User.findById(ws.userId);
        if (user.role !== 'admin' && user.role !== 'moderator') throw new Error('Unauthorized');
        const target = await User.findById(targetId);
        if (!target) throw new Error('User not found');
        target.mutedUntil = new Date(Date.now() + duration * 60 * 1000);
        await target.save();
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN && client.userId === targetId) {
            client.send(JSON.stringify({ type: 'muted', duration }));
          }
        });
      } else if (data.type === 'subscribe') {
        subscriptions.set(ws.userId, data.subscription);
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message || 'WebSocket processing error' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    for (const [userId, info] of onlineUsers) {
      if (info.ws === ws) {
        onlineUsers.delete(userId);
        subscriptions.delete(userId);
        broadcastOnlineUsers();
        break;
      }
    }
  });
});

function broadcastOnlineUsers() {
  const onlineUsersData = Array.from(onlineUsers.entries()).map(([userId, info]) => ({
    userId,
    email: info.email,
    latitude: info.latitude,
    longitude: info.longitude,
    timestamp: info.timestamp,
  }));
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.email === adminEmail) {
      client.send(JSON.stringify({ type: 'onlineUsers', users: onlineUsersData }));
    }
  });
}

function broadcastChatMessage(chatMessage) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: 'chat',
          userId: chatMessage.userId,
          username: chatMessage.username,
          message: chatMessage.message,
          timestamp: chatMessage.timestamp,
        })
      );
    }
  });
}

async function sendPushNotification(userId, message) {
  const subscription = subscriptions.get(userId);
  if (subscription) {
    try {
      await webPush.sendNotification(subscription, JSON.stringify({
        title: 'Milledgeville Alert',
        body: message,
        icon: '/icon.png'
      }));
    } catch (err) {
      console.error('Push notification error:', err);
    }
  }
}

// Admin Analytics Endpoint
const { Pin } = require('./models/pin');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
}

app.get('/admin/analytics', authenticateToken, async (req, res) => {
  if (req.user.email !== adminEmail) return res.status(403).json({ message: 'Admin only' });
  try {
    const totalPins = await Pin.countDocuments();
    const activeUsers = await User.countDocuments();
    const pinTypes = await Pin.aggregate([
      { $group: { _id: '$description', count: { $sum: 1 } } },
      { $project: { type: '$_id', count: 1, _id: 0 } },
    ]);
    const topUsers = await User.find().sort({ totalPins: -1 }).limit(5).select('username email totalPins');
    res.json({ totalPins, activeUsers, pinTypes, topUsers });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Health Check Endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Fetch all chat messages
app.get('/chat', authenticateToken, async (req, res) => {
  try {
    const chats = await Chat.find().sort({ timestamp: -1 }).limit(50);
    res.json(chats);
  } catch (err) {
    console.error('Error fetching chat messages:', err);
    res.status(500).json({ message: 'Server error fetching chat messages' });
  }
});

// Push subscription endpoint
app.post('/subscribe', authenticateToken, async (req, res) => {
  const subscription = req.body;
  subscriptions.set(req.user.id, subscription);
  res.status(201).json({ message: 'Subscription saved' });
});

// VAPID public key endpoint
app.get('/vapidPublicKey', (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
});
