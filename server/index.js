import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import OpenAI from 'openai';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

// In-memory store for OAuth tokens (use a DB or encrypted file in production)
let gmailTokens = null;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/gmail/callback`
);

// ——— Gmail OAuth ———
app.get('/auth/gmail', (req, res) => {
  const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/auth/gmail/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.redirect('/?error=no_code');
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    gmailTokens = tokens;
    oauth2Client.setCredentials(tokens);
    res.redirect('http://localhost:5173/?gmail=connected');
  } catch (err) {
    console.error('Gmail OAuth error:', err);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/api/gmail/status', (req, res) => {
  res.json({ connected: !!gmailTokens });
});

// ——— Fetch recent emails (for context to the agent) ———
app.get('/api/emails', async (req, res) => {
  if (!gmailTokens) {
    return res.status(401).json({ error: 'Gmail not connected. Connect Gmail first.' });
  }
  try {
    oauth2Client.setCredentials(gmailTokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const list = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 50,
    });
    const messages = list.data.messages || [];
    const emails = [];
    for (const msg of messages.slice(0, 20)) {
      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id });
      const payload = full.data.payload;
      const headers = payload.headers || [];
      const get = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
      const subject = get('subject');
      const from = get('from');
      const date = get('date');
      let snippet = full.data.snippet || '';
      let body = '';
      if (payload.body?.data) {
        body = Buffer.from(payload.body.data, 'base64').toString('utf-8').slice(0, 500);
      } else if (payload.parts?.length) {
        const part = payload.parts.find((p) => p.mimeType === 'text/plain') || payload.parts[0];
        if (part?.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8').slice(0, 500);
        }
      }
      emails.push({ id: msg.id, subject, from, date, snippet, body });
    }
    res.json({ emails });
  } catch (err) {
    console.error('Gmail fetch error:', err);
    if (err.code === 401) {
      gmailTokens = null;
      return res.status(401).json({ error: 'Gmail token expired. Please reconnect.' });
    }
    res.status(500).json({ error: err.message || 'Failed to fetch emails' });
  }
});

// ——— Ask agent (OpenAI) about your email ———
app.post('/api/ask', async (req, res) => {
  const { question, openaiApiKey: keyFromBody } = req.body || {};
  const apiKey = keyFromBody || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error: 'OpenAI API key required. Set OPENAI_API_KEY in .env or enter it in Settings.',
    });
  }
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Question is required.' });
  }

  let emailContext = '';
  if (gmailTokens) {
    try {
      oauth2Client.setCredentials(gmailTokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const list = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 30,
      });
      const messages = list.data.messages || [];
      const parts = [];
      for (const msg of messages.slice(0, 15)) {
        const full = await gmail.users.messages.get({ userId: 'me', id: msg.id });
        const payload = full.data.payload;
        const headers = payload.headers || [];
        const get = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        parts.push({
          subject: get('subject'),
          from: get('from'),
          date: get('date'),
          snippet: full.data.snippet || '',
        });
      }
      emailContext = 'Recent emails (subject, from, date, snippet):\n' + JSON.stringify(parts, null, 2);
    } catch (e) {
      emailContext = '(Could not fetch emails: ' + (e.message || 'error') + ')';
    }
  } else {
    emailContext = '(Gmail not connected — no email context available.)';
  }

  const openai = new OpenAI({ apiKey });
  const systemContent =
    'You are a helpful assistant that answers questions about the user\'s email. You are given a summary of their recent emails. Answer based on that context when possible. If the answer is not in the email context, say so. Be concise.';
  const userContent = `Email context:\n${emailContext}\n\nUser question: ${question}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ],
      max_tokens: 1024,
    });
    const answer = completion.choices[0]?.message?.content ?? 'No response.';
    res.json({ answer });
  } catch (err) {
    console.error('OpenAI error:', err);
    const status = err.status === 401 ? 401 : 500;
    res.status(status).json({
      error: err.message || 'OpenAI request failed. Check your API key and quota.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`API server http://localhost:${PORT}`);
});
