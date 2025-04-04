const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const pinRoutes = require('./routes/pins');
const subscribeRoutes = require('./routes/subscribe');
const trafficCameraRoutes = require('./routes/trafficCameras'); // Add this
const path = require('path');
const WebSocket = require('ws');
const Chat = require('./models/chat');
const User = require('./models/user');
const Message = require('./models/message');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');

dotenv.config();
const app = express();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://frontend-a966.onrender.com',
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use('/auth', authRoutes);
app.use('/pins', pinRoutes);
app.use('/subscribe', subscribeRoutes);
app.use('/traffic-cameras', trafficCameraRoutes); // Add this

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

// Web Push Setup with VAPID Keys
webpush.setVapidDetails(
  'mailto:your-email@example.com',
  'BIEBvt54qcb86fNJ9akRzuzzgvgY5Vi0hzvqSflNatlzIjVR6Clz02wY0by5vANRrLljbJoLR1uyRroK3Up21NM',
  'dv8PfZg9uwMlJvhUKV8LdkFIUhiF0GWHabCNuvB-ijo'
);

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
      console.log('Server received:', data);

      // WebSocket Authentication
      if (!ws.userId || !ws.email) {
        if (data.type === 'auth' && data.userId && data.email && data.token) {
          const decoded = jwt.verify(data.token, process.env.JWT_SECRET || 'your-secret-key');
          if (decoded.id === data.userId && decoded.email === data.email) {
            ws.userId = data.userId;
            ws.email = data.email;
            ws.isAdmin = data.email === adminEmail;
            console.log(`WebSocket authenticated: ${ws.email}, ${ws.userId}, Admin: ${ws.isAdmin}`);
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
        const locData = {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          email,
          ws,
          timestamp: new Date()
        };
        onlineUsers.set(userId, locData);
        await Location.findOneAndUpdate(
          { userId },
          {
            email,
            location: { type: 'Point', coordinates: [locData.longitude, locData.latitude] },
            timestamp: locData.timestamp
          },
          { upsert: true, new: true }
        );

        // Send to the user themselves
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'location', userId, email, latitude, longitude }));
        }

        // Send all locations to admins
        wss.clients.forEach((client) => {
          if (client.isAdmin && client.readyState === WebSocket.OPEN) {
            const allLocations = Array.from(onlineUsers.entries()).map(([userId, info]) => ({
              userId,
              email: info.email,
              latitude: info.latitude,
              longitude: info.longitude
            }));
            client.send(JSON.stringify({
              type: 'allLocations',
              locations: allLocations
            }));
          }
        });
      } else if (data.type === 'chat') {
        const { userId, username, message } = data;
        if (!message.trim()) throw new Error('Message cannot be empty');
        const chatMessage = new Chat({ userId, username, message });
        await chatMessage.save();
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: 'chat',
                userId,
                username,
                message,
                timestamp: chatMessage.timestamp,
              })
            );
          }
        });
      } else if (data.type === 'privateMessage') {
        const { senderId, recipientId, content } = data;
        if (!content.trim()) throw new Error('Message content cannot be empty');
        const messageDoc = new Message({ senderId, recipientId, content });
        await messageDoc.save();
        const recipientWs = Array.from(onlineUsers.values()).find((u) => u.ws.userId === recipientId)?.ws;
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          recipientWs.send(JSON.stringify({ type: 'privateMessage', senderId, recipientId, content }));
        }
      } else if (data.type === 'newPin') {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'newPin', pin: data.pin }));
          }
        });
      } else if (data.type === 'newComment') {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'newComment', pinId: data.pinId }));
          }
        });
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message || 'WebSocket processing error' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected:', ws.userId);
    onlineUsers.delete(ws.userId);
    wss.clients.forEach((client) => {
      if (client.isAdmin && client.readyState === WebSocket.OPEN) {
        const allLocations = Array.from(onlineUsers.entries()).map(([userId, info]) => ({
          userId,
          email: info.email,
          latitude: info.latitude,
          longitude: info.longitude
        }));
        client.send(JSON.stringify({
          type: 'allLocations',
          locations: allLocations
        }));
      }
    });
  });
});

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
