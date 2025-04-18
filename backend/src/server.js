const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const webPush = require('web-push');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'https://frontend-a966.onrender.com' }
});

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);

// Web Push setup
const vapidKeys = {
  publicKey: 'BIEBvt54qcb86fNJ9akRzuzzgvgY5Vi0hzvqSflNatlzIjVR6Clz02wY0by5vANRrLljbJoLR1uyRroK3Up21NM',
  privateKey: 'dv8PfZg9uwMlJvhUKV8LdkFIUhiF0GWHabCNuvB-ijo'
};
webPush.setVapidDetails(
  'mailto:your-email@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Simulate traffic alerts
setInterval(() => {
  const alert = { message: 'Speed camera in 0.2 miles' };
  io.emit('alert', alert);
}, 30000);

// Store subscriptions
const subscriptions = [];

app.post('/api/subscribe', (req, res) => {
  subscriptions.push(req.body);
  res.status(201).json({});
});

io.on('connection', (socket) => {
  console.log('Client connected');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
