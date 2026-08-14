// ============================================
// FESTIVAL COLLECTION API - CENTRAL SERVER
// STEP 3: Meta WhatsApp Cloud API Integration
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

// Razorpay
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// WhatsApp - Meta Cloud API
const WHATSAPP_PROVIDER = process.env.WHATSAPP_PROVIDER || 'meta';
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error('❌ Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in environment!');
}

if (WHATSAPP_PROVIDER === 'meta') {
  if (!META_PHONE_NUMBER_ID || !META_ACCESS_TOKEN || !META_GRAPH_VERSION) {
    console.warn('⚠️ Meta WhatsApp credentials missing. WhatsApp messaging will not work.');
    console.warn('⚠️ Required: META_PHONE_NUMBER_ID, META_ACCESS_TOKEN, META_GRAPH_VERSION');
  }
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
// ENDPOINT 2: Send WhatsApp Message (Text)
// POST /api/send-message
// ============================================

app.post('/api/send-message', validateApiKey, async (req, res) => {
  try {
    const WHATSAPP_CONFIG = {
      apiUrl: 'https://festival-collection-api.onrender.com/api/send-message',
      apiKey: 'TEST_KEY_123'
    };
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
// ENDPOINT: Send WhatsApp Template (Production)
// POST /api/send-template
// ============================================

app.post('/api/send-template', validateApiKey, async (req, res) => {
  try {
    const { mobile, templateName, variables, language } = req.body;

    if (!mobile || !templateName) {
      return res.status(400).json({
        error: 'Missing mobile or templateName'
      });
    }

    console.log(`📱 Sending template ${templateName} to ${mobile}`);

    const result = await sendWhatsAppTemplate(
      mobile,
      templateName,
      variables || [],
      language || 'en_IN'
    );

    return res.json({
      success: true,
      result
    });

  } catch (error) {
    const metaError = error.response?.data || error.message;

    console.error(
      '❌ Send Template Error Details:',
      JSON.stringify(metaError, null, 2)
    );

    return res.status(500).json({
      error: 'Failed to send template',
      details: metaError
    });
  }
});

// ============================================
// WHATSAPP SENDER – META CLOUD API (TEXT)
// ============================================

async function sendWhatsAppMessage(mobile, message) {
  try {
    if (WHATSAPP_PROVIDER !== 'meta') {
      throw new Error(`Unsupported WhatsApp provider: ${WHATSAPP_PROVIDER}`);
    }

    if (!META_PHONE_NUMBER_ID || !META_ACCESS_TOKEN || !META_GRAPH_VERSION) {
      throw new Error('Meta WhatsApp credentials are not configured');
    }

    // Clean recipient number – remove + for Meta API
    const cleanMobile = String(mobile).replace(/\s/g, '');
    const recipient = cleanMobile.replace(/^\+/, '');

    console.log(`📱 Sending WhatsApp message to ${recipient}`);

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: {
        body: message
      }
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ WhatsApp message accepted by Meta for ${recipient}`);
    return response.data;

  } catch (error) {
    console.error('❌ Meta WhatsApp API Error:', error.response?.data || error.message);
    throw error;
  }
}

// ============================================
// WHATSAPP TEMPLATE SENDER – META CLOUD API
// ============================================

async function sendWhatsAppTemplate(mobile, templateName, variables, language = 'en_IN') {
  try {
    if (WHATSAPP_PROVIDER !== 'meta') {
      throw new Error(`Unsupported WhatsApp provider: ${WHATSAPP_PROVIDER}`);
    }

    if (!META_PHONE_NUMBER_ID || !META_ACCESS_TOKEN || !META_GRAPH_VERSION) {
      throw new Error('Meta WhatsApp credentials are not configured');
    }

    // Clean recipient number – remove + for Meta API
    const cleanMobile = String(mobile).replace(/\s/g, '');
    const recipient = cleanMobile.replace(/^\+/, '');

    console.log(`📱 Sending template ${templateName} to ${recipient}`);

    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: language
        },
        components: [
          {
            type: 'body',
            parameters: variables.map(v => ({
              type: 'text',
              text: v
            }))
          }
        ]
      }
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Template accepted by Meta for ${recipient}`);
    return response.data;

  } catch (error) {
    console.error('❌ Meta Template Error:', error.response?.data || error.message);
    throw error;
  }
}

// ============================================
// ENDPOINT 4: Health Check
// GET /api/health
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Festival Collection API is running!',
    razorpay_configured: !!(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET),
    meta_configured: !!(META_PHONE_NUMBER_ID && META_ACCESS_TOKEN && META_GRAPH_VERSION),
    meta_graph_version: META_GRAPH_VERSION || 'Not Set',
    activeKeys: Object.keys(API_KEYS).length,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// WHATSAPP WEBHOOK – META CLOUD API
// ============================================

// Meta webhook verification
app.get('/api/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode === 'subscribe' &&
    token === process.env.META_WEBHOOK_VERIFY_TOKEN
  ) {
    console.log('✅ Meta webhook verified');
    return res.status(200).send(challenge);
  }

  console.error('❌ Meta webhook verification failed');
  return res.sendStatus(403);
});


// Receive WhatsApp webhook events
app.post('/api/webhook', (req, res) => {
  try {
    console.log('📩 WhatsApp webhook received');

    const body = req.body;

    console.log(
      '📦 Webhook payload:',
      JSON.stringify(body, null, 2)
    );

    // Process WhatsApp status updates
    const entries = body.entry || [];

    entries.forEach(entry => {
      const changes = entry.changes || [];

      changes.forEach(change => {
        const value = change.value || {};

        const statuses = value.statuses || [];

        statuses.forEach(status => {
          console.log(
            `📱 WhatsApp status: ${status.id} → ${status.status}`
          );

          if (status.recipient_id) {
            console.log(
              `👤 Recipient: ${status.recipient_id}`
            );
          }
        });
      });
    });

    // Meta expects HTTP 200
    return res.sendStatus(200);

  } catch (error) {
    console.error(
      '❌ WhatsApp webhook error:',
      error.message
    );

    // Still acknowledge the webhook
    return res.sendStatus(200);
  }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`💳 Razorpay: ${RAZORPAY_KEY_ID ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`📱 WhatsApp: ${
    META_PHONE_NUMBER_ID && META_ACCESS_TOKEN && META_GRAPH_VERSION
      ? '✅ Meta Configured'
      : '❌ Meta Not Configured'
  }`);
  console.log(`📊 Graph API Version: ${META_GRAPH_VERSION || 'Not Set'}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
});

// ============================================
// EXPOSE FOR TESTING (Optional)
// ============================================

module.exports = app;
