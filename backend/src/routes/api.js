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
        key: 'bd8d616c-8e70-45f6-9146-a9306dc100da'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Routing error:', error.message);
    res.status(500).json({ error: 'Routing failed' });
  }
});

module.exports = router;
