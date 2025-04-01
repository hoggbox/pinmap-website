// server.js
const express = require('express');
const mongoose = require('mongoose');
const WebSocket = require('ws');
const path = require('path');
const pinRoutes = require('./routes/pins');
const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const weatherRoutes = require('./routes/weather');
require('dotenv').config(); // Load environment variables from .env file

const app = express();
const port = process.env.PORT || 3000;

// Use environment variable for MongoDB URI, default to a local address if not found
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/milledgeville_map', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/pins', pinRoutes);
app.use('/auth', authRoutes);
app.use('/messages', messageRoutes);
app.use('/weather', weatherRoutes);

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Handle all other requests by serving the frontend's index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// WebSocket Server Setup
const wss = new WebSocket.Server({ server });
const clients = new Map();

wss.on('connection', (ws, req) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'location') {
        clients.set(data.userId, ws);
        if (data.email === 'imhoggbox@gmail.com') {
          const allLocations = Array.from(clients.entries()).map(([userId, _]) => ({
            userId,
            email: data.email,
            latitude: data.latitude,
            longitude: data.longitude
          }));
          ws.send(JSON.stringify({ type: 'allLocations', locations: allLocations }));
        } else {
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== ws) {
              client.send(JSON.stringify({
                type: 'location',
                userId: data.userId,
                email: data.email,
                latitude: data.latitude,
                longitude: data.longitude
              }));
            }
          });
        }
      } else if (data.type === 'chat') {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'chat',
              userId: data.userId,
              username: data.username,
              message: data.message,
              timestamp: new Date()
            }));
          }
        });
      } else if (data.type === 'privateMessage') {
        const recipientWs = clients.get(data.recipientId);
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
          recipientWs.send(JSON.stringify({ type: 'privateMessage' }));
        }
      } else if (data.type === 'pin') {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'pin' }));
          }
        });
      } else if (data.type === 'comment') {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'comment', pinId: data.pinId }));
          }
        });
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {
    for (let [userId, client] of clients) {
      if (client === ws) {
        clients.delete(userId);
        break;
      }
    }
  });
});

app.get('/set-ws-email', (req, res) => {
  const { email, userId } = req.query;
  if (email && userId) {
    clients.set(userId, clients.get(userId) || null);
    res.sendStatus(200);
  } else {
    res.sendStatus(400);
  }
});
