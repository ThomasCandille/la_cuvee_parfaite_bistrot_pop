/**
 * La Cuvée Parfaite — serveur Node.js sans dépendance.
 * La clé d'accès Azure reste côté serveur : ne jamais l'inclure dans public/.
 * Node 18+ requis (fetch intégré).
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const WEB_ROOT = path.join(ROOT, 'public');

// Charge un fichier .env local si présent, sans installer de librairie.
function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'")) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadEnvFile();

const AZURE_URI = process.env.AZUREML_SCORING_URI || 'https://wine-thomas-11050920.italynorth.inference.ml.azure.com/score';
const AZURE_KEY = process.env.AZUREML_API_KEY || '';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const IS_DEMO = process.env.DEMO_MODE === 'true' || !AZURE_KEY;

const FEATURES = [
  'fixed acidity', 'volatile acidity', 'citric acid', 'residual sugar', 'chlorides',
  'free sulfur dioxide', 'total sulfur dioxide', 'density', 'pH', 'sulphates', 'alcohol'
];
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/demo-data.js': ['demo-data.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml']
};
const hits = new Map();

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function validateBody(data) {
  if (!data || !Array.isArray(data.data) || data.data.length !== 1 || !data.data[0] || typeof data.data[0] !== 'object') {
    throw new Error('Format attendu : {"data": [{...11 paramètres...}]} (un seul vin par requête).');
  }
  const sample = data.data[0];
  const missing = FEATURES.filter(key => !(key in sample));
  if (missing.length) throw new Error(`Paramètres manquants : ${missing.join(', ')}`);
  const values = {};
  for (const key of FEATURES) {
    if (typeof sample[key] !== 'number' || !Number.isFinite(sample[key])) {
      throw new Error(`Valeur numérique invalide pour "${key}".`);
    }
    values[key] = sample[key];
  }
  return values;
}

function unpackJson(value) {
  let obj = value;
  for (let i = 0; i < 2 && typeof obj === 'string'; i++) {
    try { obj = JSON.parse(obj); } catch (_) { break; }
  }
  if (obj && typeof obj === 'object' && obj.result !== undefined && !obj.predictions) {
    return unpackJson(obj.result);
  }
  return obj;
}

function normalizedAzureOutput(raw) {
  const obj = unpackJson(raw);
  if (!obj || typeof obj !== 'object') throw new Error('Réponse Azure illisible (JSON attendu).');
  if (obj.erreur || obj.error) {
    const explanation = String(obj.erreur || obj.error);
    if (explanation.includes('Unnamed: 0')) {
      throw new Error('Le modèle Azure attend toujours « Unnamed: 0 ». Réentraîne-le sans cette colonne, puis redéploie-le.');
    }
    throw new Error(explanation.slice(0, 500));
  }
  if (!Array.isArray(obj.predictions) || obj.predictions.length < 1) {
    throw new Error('La réponse Azure ne contient pas « predictions » : vérifie deploy/score.py.');
  }
  const prediction = Number(obj.predictions[0]);
  if (prediction !== 0 && prediction !== 1) throw new Error('Prédiction invalide : 0 ou 1 attendu.');
  let array = obj.probabilites_bon_vin ?? obj.probabilites_defaut ?? obj.probabilites ?? obj.probabilities ?? null;
  if (Array.isArray(array)) {
    array = array[0];
    if (Array.isArray(array)) array = array[1];
  }
  const probability = array !== null && Number.isFinite(Number(array)) ? Math.max(0, Math.min(1, Number(array))) : null;
  return { prediction, probability, mode: 'azure' };
}

function requestLimited(req) {
  // Petit garde-fou pour éviter des appels excessifs à un endpoint facturé.
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const info = hits.get(ip);
  if (!info || now - info.since > 60_000) {
    hits.set(ip, { since: now, count: 1 });
    return false;
  }
  info.count += 1;
  return info.count > 45;
}

async function handlePredict(req, res) {
  if (IS_DEMO) {
    return json(res, 503, { erreur: 'Endpoint Azure non configuré : ajoute AZUREML_API_KEY au fichier .env. Le mode découverte reste disponible dans le navigateur.' });
  }
  if (requestLimited(req)) return json(res, 429, { erreur: 'Trop de dégustations : réessaie dans une minute.' });
  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk.toString('utf8');
      if (body.length > 16_384) return json(res, 413, { erreur: 'Requête trop volumineuse.' });
    }
  } catch (_) { return json(res, 400, { erreur: 'Lecture de la requête impossible.' }); }
  let sample;
  try { sample = validateBody(JSON.parse(body)); }
  catch (error) { return json(res, 400, { erreur: String(error.message).slice(0, 500) }); }
  try {
    const response = await fetch(AZURE_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AZURE_KEY}` },
      body: JSON.stringify({ data: [sample] }),
      signal: AbortSignal.timeout(28000)
    });
    const text = await response.text();
    if (!response.ok) {
      console.error('Azure ML HTTP', response.status, text.slice(0, 250));
      const description = response.status === 401 || response.status === 403
        ? 'Accès Azure refusé : vérifie AZUREML_API_KEY et le statut de ton endpoint.'
        : `Azure ML a répondu HTTP ${response.status}. Vérifie le déploiement.`;
      return json(res, 502, { erreur: description });
    }
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('L’endpoint a renvoyé une réponse non JSON.'); }
    return json(res, 200, normalizedAzureOutput(data));
  } catch (error) {
    console.error('[Azure ML]', error.message);
    return json(res, 502, { erreur: error.name === 'TimeoutError' ? 'Délai dépassé : endpoint Azure indisponible.' : String(error.message).slice(0, 500) });
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  const reqPath = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && reqPath === '/api/status') {
    return json(res, 200, { mode: IS_DEMO ? 'demo' : 'azure', configured: !IS_DEMO });
  }
  if (req.method === 'POST' && reqPath === '/api/predict') return handlePredict(req, res);
  if (req.method === 'GET' && STATIC_FILES[reqPath]) {
    const [filename, contentType] = STATIC_FILES[reqPath];
    const file = path.join(WEB_ROOT, filename);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    return fs.createReadStream(file).pipe(res);
  }
  return json(res, 404, { erreur: 'Page introuvable.' });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`La Cuvée Parfaite : http://${HOST}:${PORT}`);
    console.log(IS_DEMO ? 'MODE DÉCOUVERTE : aucune requête Azure.' : 'MODE AZURE : endpoint sécurisé côté serveur.');
  });
}
module.exports = { server, normalizedAzureOutput, validateBody };
