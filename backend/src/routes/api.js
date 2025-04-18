const express = require('express');
const axios = require('axios');
const router = express.Router();

router.get('/route', async (req, res) => {
  const { start, end } = req.query;
  try {
    const response = await axios.get('https://graphhopper.com/api/1/route', {
      params: {
        point: [start, end],
        vehicle: 'car',
        locale: 'en',
        key: process.env.GRAPH_HOPPER_API_KEY
      }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Routing failed' });
  }
});

module.exports = router;
