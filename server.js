const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLÉ_API_ANTHROPIC;
const NOTION_TOKEN = process.env.NOTION_TOKEN;

// IDs des bases Notion
const DB = {
  agents:    '214a12376ab3802d86a0c166920a50c3',
  prestas:   '328a12376ab380f2926dd048912c453b',
  sites:     '26aa12376ab3803296ece3863941f299',
  pointages: 'b0b4acfd6dac4d06a41d66c658675d8c'
};

// ── NOTION API ────────────────────────────────────────────────────────────────
function notionRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path: `/v1/${endpoint}`,
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': data.length } : {})
      }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Récupère tous les résultats d'une query (gère la pagination)
async function queryAll(dbId, filter) {
  let results = [], cursor;
  do {
    const body = { page_size: 100, ...(filter ? {filter} : {}), ...(cursor ? {start_cursor: cursor} : {}) };
    const res = await notionRequest('POST', `databases/${dbId}/query`, body);console.log('Notion response:', JSON.stringify(res).slice(0, 500));
    results = results.concat(res.results || []);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return results;
}

// ── ROUTES API ────────────────────────────────────────────────────────────────
async function handleAPI(req, res, pathname) {

  // GET /api/agents?site=ID
  if (req.method === 'GET' && pathname === '/api/agents') {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const siteId = params.get('site');
    const today = new Date().toISOString().split('T')[0];

   try {
  const result = await notionRequest('POST', `databases/${DB.agents}/query`, { page_size: 10 });
  console.log('Notion raw:', JSON.stringify(result).slice(0, 300));
  const agents = (result.results || []).map(p => ({
    id: p.id,
    nom: p.properties['Nom']?.title?.[0]?.plain_text || '',
    cartePro: '0000'
  })).filter(a => a.nom);
  res.writeHead(200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({ agents }));
} catch(e) {
  console.error('Erreur:', e.message);
  res.writeHead(500, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({ error: e.message, agents: [] }));
}

      // 2. Récupère les agents
      let agentPages = [];
      if (siteId && prestationsActives.length > 0) {
        // Agents liés aux prestations actives de ce site
        const agentIds = new Set();
        for (const presta of prestationsActives) {
          const agentsRel = presta.properties['Agents']?.relation || [];
          agentsRel.forEach(a => agentIds.add(a.id));
        }
        // Fetch chaque agent
        const fetches = [...agentIds].map(id => notionRequest('GET', `pages/${id}`, null));
        agentPages = await Promise.all(fetches);
        // Associe la prestation à chaque agent
        agentPages = agentPages.map(agent => {
          const presta = prestationsActives.find(p =>
            p.properties['Agents']?.relation?.some(a => a.id === agent.id)
          );
          return { ...agent, _prestation: presta };
        });
      } else if (!siteId) {
        // Mode sans site — tous les agents
        agentPages = await queryAll(DB.agents);
      }

      const agents = agentPages
        .filter(p => p && p.properties)
        .map(p => {
          const props = p.properties;
          const presta = p._prestation;
          return {
            id: p.id,
            nom: props['Nom']?.title?.[0]?.plain_text || '',
cartePro: props['Carte Pro']?.rich_text?.[0]?.plain_text || '0000',            prestationNom: presta?.properties?.['Nom']?.title?.[0]?.plain_text || null,
            client: presta?.properties?.['🏢 Clients / Entreprises']?.relation?.[0]?.id || null
          };
        })
.filter(a => a.nom);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ agents }));
    } catch(e) {
      console.error('Erreur /api/agents:', e);
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // POST /api/pointage
  if (req.method === 'POST' && pathname === '/api/pointage') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const d = JSON.parse(body);
        const now = new Date(d.horodatage || new Date());

        const page = {
          parent: { database_id: DB.pointages },
          properties: {
            'Nom': { title: [{ text: { content: d.nom } }] },
            'Type': { select: { name: d.type } },
            'Horodatage': { date: { start: now.toISOString() } },
            'Agent': { relation: [{ id: d.agentId }] },
            'PIN vérifié': { checkbox: true },
            'GPS': { rich_text: [{ text: { content: d.gps || 'Non disponible' } }] },
            'Statut vacation': { select: { name: d.type === 'Début de service' ? 'En poste' : 'Terminé' } },
            ...(d.prestationId ? { 'Prestation': { relation: [{ id: d.prestationId }] } } : {}),
            ...(d.siteId ? { 'Site': { relation: [{ id: d.siteId }] } } : {})
          },
          children: [{
            object: 'block', type: 'paragraph',
            paragraph: { rich_text: [{ text: { content:
              `Agent: ${d.agentNom}\nCarte Pro: ${d.cartePro}\nType: ${d.type}\nHorodatage: ${now.toLocaleString('fr-FR')}\nGPS: ${d.gps || 'N/A'}\nPIN vérifié: OUI\nPrestation: ${d.prestationNom || 'N/A'}\nSite: ${d.siteName || 'N/A'}`
            }}] }
          }]
        };

        const result = await notionRequest('POST', 'pages', page);
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: true, pageUrl: result.url, pageId: result.id }));
      } catch(e) {
        console.error('Erreur /api/pointage:', e);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
}

// ── SERVEUR ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname.startsWith('/api/')) {
    handleAPI(req, res, pathname);
    return;
  }

  // Fichiers statiques
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  const mime = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon' };

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': mime[ext] || 'text/plain'});
    res.end(content);
  });
});

server.listen(PORT, () => console.log(`Jet Guards démarré sur le port ${PORT}`));
