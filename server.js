// ============================================
// FESTIVAL COLLECTION API - CENTRAL SERVER
// STEP 3: WhatsApp Integration Added
// ============================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ============================================
// CONFIG - Read from Environment Variables
// ============================================

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// WhatsApp Config
const WHATSAPP_PROVIDER = process.env.WHATSAPP_PROVIDER || 'twilio';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error('❌ Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in environment!');
}

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
  console.warn('⚠️ Twilio credentials missing. WhatsApp will not work.');
}

// ============================================
// API KEY STORE (In-memory)
// ============================================

const API_KEYS = {
  'TEST_KEY_123': {
    mandalName: "Test Mandal",
    expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000),
    isActive: true
  }
};

// ============================================
// MIDDLEWARE: Validate API Key
// ============================================

function validateApiKey(req, res, next) {
  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API Key' });
  }

  const keyData = API_KEYS[apiKey];

  if (!keyData) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  if (!keyData.isActive) {
    return res.status(403).json({ error: 'API Key is deactivated' });
  }

  if (keyData.expiresAt < Date.now()) {
    return res.status(403).json({ error: 'API Key has expired. Please renew.' });
  }

  req.mandalName = keyData.mandalName;
  next();
}

// ============================================
// ENDPOINT 1: Generate Razorpay Payment Link
// POST /api/generate-link
// ============================================

app.post('/api/generate-link', validateApiKey, async (req, res) => {
  try {
    const { amount, name, mobile, donationId } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!donationId) {
      return res.status(400).json({ error: 'Missing donationId' });
    }

    console.log(`📝 Generating link for ${name} | ₹${amount} | ${donationId}`);

    const amountInPaise = Math.round(parseFloat(amount) * 100);

    const payload = {
      amount: amountInPaise,
      currency: 'INR',
      accept_partial: false,
      expire_by: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
      reference_id: donationId,
      description: `Contribution to ${req.mandalName}`,
      customer: {
        name: name || 'Anonymous Supporter',
        contact: mobile.replace(/\s/g, '')
      },
      notify: { sms: false, email: false, whatsapp: false },
      reminder_enable: false,
      notes: {
        donation_id: donationId,
        mandal: req.mandalName
      }
    };

    const auth = Buffer.from(RAZORPAY_KEY_ID + ':' + RAZORPAY_KEY_SECRET).toString('base64');

    const response = await axios.post(
      'https://api.razorpay.com/v1/payment_links',
      payload,
      {
        headers: {
          'Authorization': 'Basic ' + auth,
          'Content-Type': 'application/json'
        }
      }
    );

    const link = response.data.short_url;

    if (!link) {
      throw new Error('Razorpay did not return a link');
    }

    console.log(`✅ Link generated: ${link}`);
    return res.json({ success: true, payment_link: link });

  } catch (error) {
    console.error('❌ Generate Link Error:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Failed to generate payment link',
      details: error.response?.data?.error?.description || error.message
    });
  }
});

// ============================================
// ENDPOINT 2: Send WhatsApp Message
// POST /api/send-message
// ============================================

app.post('/api/send-message', validateApiKey, async (req, res) => {
  try {
    const { mobile, message } = req.body;

    if (!mobile || !message) {
      return res.status(400).json({ error: 'Missing mobile or message' });
    }

    console.log(`📱 Sending WhatsApp to ${mobile}`);

    const result = await sendWhatsAppMessage(mobile, message);
    return res.json({ success: true, result });

  } catch (error) {
    console.error('❌ Send Message Error:', error.message);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

// ============================================
// WHATSAPP SENDER FUNCTION
// ============================================

async function sendWhatsAppMessage(mobile, message) {
  try {
    console.log(`🔍 Starting WhatsApp send to: ${mobile}`);
    console.log(`📝 Message: ${message.substring(0, 50)}...`);
    // Clean and format the recipient number
    const cleanMobile = mobile.replace(/\s/g, '');
    const finalMobile = cleanMobile.startsWith('+') ? cleanMobile : '+' + cleanMobile;
    const recipient = 'whatsapp:' + finalMobile;

    console.log(`📱 Formatted recipient: ${recipient}`);
    console.log(`📱 From: ${TWILIO_WHATSAPP_NUMBER}`);

    // --- Twilio ---
    if (WHATSAPP_PROVIDER === 'twilio') {
      console.log('🔍 Using Twilio provider');
      const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const auth = Buffer.from(TWILIO_ACCOUNT_SID + ':' + TWILIO_AUTH_TOKEN).toString('base64');

      const params = new URLSearchParams();
      params.append('To', recipient);
      params.append('From', TWILIO_WHATSAPP_NUMBER);
      params.append('Body', message);

      console.log('🔍 Sending request to Twilio...');

      const response = await axios.post(url, params, {
        headers: {
          'Authorization': 'Basic ' + auth,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      console.log(`✅ WhatsApp sent to ${recipient}`);
      return response.data;
    }

    else {
      console.log('⚠️ No WhatsApp provider configured. Message preview:');
      console.log('To:', recipient);
      console.log('Message:', message);
      return { status: 'logged' };
    }
  } catch (error) {
    console.error('❌ Twilio API Error:', error.response?.data || error.message);
    throw error;
  }
}

// ============================================
// ENDPOINT 3: Health Check
// GET /api/health
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Festival Collection API is running!',
    razorpay_configured: !!(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET),
    whatsapp_configured: !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_NUMBER),
    activeKeys: Object.keys(API_KEYS).length,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`💳 Razorpay: ${RAZORPAY_KEY_ID ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`📱 WhatsApp: ${TWILIO_ACCOUNT_SID ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
});
