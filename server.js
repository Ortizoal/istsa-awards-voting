const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const voteAttempts = new Map();
const votes = [];
const registrationSequence = { value: 34 };
const MAX_PHOTO_BYTES = 500 * 1024 * 1024;
const MAX_PHOTO_DATA_URL_LENGTH = Math.ceil(MAX_PHOTO_BYTES * 1.4);

const categories = [
  'Student Leader of the Year',
  'Tech Innovator of the Year',
  'Most Outstanding Student',
  'Best Dressed',
  'Academic Excellence Award',
  'Best Programmer of the Year',
  'Female Tech Trailblazer',
  'Entrepreneur of the Year',
  'Most Active ISTSA Member',
  'Creative Media Personality'
];
const nominees = [
  { name: 'Ama Serwaa', code: 'SLY-014', category: categories[0], programme: 'BSc Information Systems', photo: 'https://i.pravatar.cc/400?img=47' },
  { name: 'Kofi Mensah', code: 'SLY-021', category: categories[0], programme: 'BSc Information Technology', photo: 'https://i.pravatar.cc/400?img=12' },
  { name: 'Naa Odoi', code: 'TIN-008', category: categories[1], programme: 'BSc Information Systems', photo: 'https://i.pravatar.cc/400?img=32' },
  { name: 'Kwesi Antwi', code: 'TIN-019', category: categories[1], programme: 'BSc Information Technology', photo: 'https://i.pravatar.cc/400?img=68' },
  { name: 'Fati Osman', code: 'MOS-006', category: categories[2], programme: 'BSc Information Systems', photo: 'https://i.pravatar.cc/400?img=49' },
  { name: 'Daniel Owusu', code: 'BDS-011', category: categories[3], programme: 'BSc Information Technology', photo: 'https://i.pravatar.cc/400?img=53' },
  { name: 'Esi Nyarko', code: 'ACA-024', category: categories[4], programme: 'BSc Information Systems', photo: 'https://i.pravatar.cc/400?img=45' },
  { name: 'Michael Badu', code: 'BPR-031', category: categories[5], programme: 'BSc Information Technology', photo: 'https://i.pravatar.cc/400?img=14' },
  { name: 'Abena Boateng', code: 'FTT-017', category: categories[6], programme: 'BSc Information Systems', photo: 'https://i.pravatar.cc/400?img=44' },
  { name: 'Richmond Asare', code: 'ENT-029', category: categories[7], programme: 'BSc Information Technology', photo: 'https://i.pravatar.cc/400?img=60' },
  { name: 'Akosua Owusu', code: 'AIM-022', category: categories[8], programme: 'BSc Information Systems', photo: 'https://i.pravatar.cc/400?img=48' },
  { name: 'Emmanuel Tetteh', code: 'CMP-013', category: categories[9], programme: 'BSc Information Technology', photo: 'https://i.pravatar.cc/400?img=58' }
];
function nomineeFor(category, code) { return nominees.find(n => n.category === category && n.code === code); }

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > MAX_PHOTO_DATA_URL_LENGTH) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid request body')); } });
  });
}
async function paystack(pathname, options) {
  const response = await fetch(`https://api.paystack.co${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok || !data.status) throw new Error(data.message || 'Paystack request failed');
  return data;
}
async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/categories') return json(res, 200, categories);
  if (req.method === 'GET' && url.pathname === '/api/nominees') return json(res, 200, nominees);
  if (req.method === 'GET' && url.pathname === '/api/results') {
    const results = categories.map(category => ({ category, nominees: nominees.filter(n => n.category === category).map(n => ({ ...n, votes: votes.filter(v => v.nomineeCode === n.code).reduce((sum, v) => sum + v.quantity, 0) })).sort((a, b) => b.votes - a.votes) }));
    return json(res, 200, { results, updatedAt: new Date().toISOString() });
  }
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const { name, email, category, photo } = await readBody(req);
    if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || !categories.includes(category)) return json(res, 400, { message: 'Please complete your name, email and category.' });
    if (photo && (!photo.startsWith('data:image/') || photo.length > MAX_PHOTO_DATA_URL_LENGTH)) return json(res, 400, { message: 'Please upload a JPG, PNG or WEBP photo smaller than 500 MB.' });
    const prefix = category.split(' ').map(word => word[0]).join('').slice(0, 3).toUpperCase();
    const code = `${prefix}-${String(++registrationSequence.value).padStart(3, '0')}`;
    nominees.push({ name: name.trim(), code, category, programme: 'ISTSA Student', photo: photo || `https://i.pravatar.cc/400?u=${encodeURIComponent(code)}` });
    return json(res, 201, { message: 'Registration submitted successfully.', code });
  }
  if (req.method === 'POST' && url.pathname === '/api/initialize-payment') {
    if (!PAYSTACK_SECRET_KEY) return json(res, 503, { message: 'Payments are not configured. Add PAYSTACK_SECRET_KEY to your environment.' });
    const { email, category, nomineeCode, quantity } = await readBody(req);
    const amountVotes = Number(quantity);
    if (!/^\S+@\S+\.\S+$/.test(email || '') || !nomineeFor(category, nomineeCode) || !Number.isInteger(amountVotes) || amountVotes < 1 || amountVotes > 100) {
      return json(res, 400, { message: 'Please provide a valid email, category, nominee code and vote quantity.' });
    }
    const reference = `ISTSA-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    voteAttempts.set(reference, { email, category, nomineeCode, quantity: amountVotes, amount: amountVotes * 50, recorded: false });
    const transaction = await paystack('/transaction/initialize', {
      method: 'POST', body: JSON.stringify({ email, amount: amountVotes * 50, currency: 'GHS', reference, callback_url: `${PUBLIC_URL}/?reference=${reference}`, metadata: { category, nomineeCode, quantity: amountVotes } })
    });
    return json(res, 200, { authorizationUrl: transaction.data.authorization_url });
  }
  if (req.method === 'GET' && url.pathname === '/api/verify-payment') {
    if (!PAYSTACK_SECRET_KEY) return json(res, 503, { message: 'Payments are not configured.' });
    const reference = url.searchParams.get('reference');
    const attempt = voteAttempts.get(reference);
    if (!reference || !attempt) return json(res, 404, { message: 'Vote attempt was not found.' });
    const transaction = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    const paid = transaction.data.status === 'success' && transaction.data.amount === attempt.amount && transaction.data.currency === 'GHS';
    if (paid && !attempt.recorded) { votes.push({ ...attempt, reference, createdAt: new Date().toISOString() }); attempt.recorded = true; }
    return json(res, 200, { paid, recorded: attempt.recorded, category: attempt.category, nomineeCode: attempt.nomineeCode, quantity: attempt.quantity });
  }
  json(res, 404, { message: 'Not found' });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, PUBLIC_URL);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const safeFile = path.normalize(path.join(__dirname, 'public', requested));
    if (!safeFile.startsWith(path.join(__dirname, 'public'))) return json(res, 403, { message: 'Forbidden' });
    fs.readFile(safeFile, (err, content) => {
      if (err) return res.end('Not found');
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
      res.writeHead(200, { 'Content-Type': types[path.extname(safeFile)] || 'application/octet-stream' }); res.end(content);
    });
  } catch (error) { console.error(error); json(res, 500, { message: error.message || 'Something went wrong.' }); }
});
server.listen(PORT, () => console.log(`ISTSA voting is running at ${PUBLIC_URL}`));
