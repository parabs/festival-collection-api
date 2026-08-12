// ============================================
// FESTIVAL COLLECTION API - CENTRAL SERVER
// STEP 1: Basic Server with Health Check (FIXED)
// ============================================

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check endpoint - test if server is running
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Festival Collection API is running!',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
});
