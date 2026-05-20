const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const AGENTS_DB = '214a12376ab3802d86a0c166920a50c3';
const POINTAGES_DB = 'b0b4acfd6dac4d06a41d66c658675d8c';

function notionRequest(method, endpoint, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? Buffer.from(JSON.stringify(body)) : null;
    var options = {
      hostname: 'api.notion.com',
      port: 443,
      path: '/v1/' + endpoint,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };
    if (data) options.headers['Content-Length'] = data.length;
    var req = https.request(options, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

var server = http.createServer(function(req, res) {
  var parsed = url.parse(req.url);
  var pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/api/agents') {
    notionRequest('POST', 'databases/' + AGENTS_DB + '/query', { page_size: 100 })
      .then(function(result) {
        var agents = (result.results || []).map(function(p) {
          var props = p.properties;
          var nom = props['Nom'] && props['Nom'].title && props['Nom'].title[0] ? props['Nom'].title[0].plain_text : '';
          var cartePro = props['Carte Pro'] && props['Carte Pro'].rich_text && props['Carte Pro'].rich_text[0] ? props['Carte Pro'].rich_text[0].plain_text : '0000';
          return { id: p.id, nom: nom, cartePro: cartePro };
        }).filter(function(a) { return a.nom; });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ agents: agents }));
      })
      .catch(function(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message, agents: [] }));
      });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/pointage') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      var d;
      try { d = JSON.parse(body); }
      catch(e) { res.writeHead(400); res.end('Bad request'); return; }

      var now = new Date(d.horodatage || new Date());
      var page = {
        parent: { database_id: POINTAGES_DB },
        properties: {
          'Nom': { title: [{ text: { content: d.nom } }] },
          'Type': { select: { name: d.type } },
          'Horodatage': { date: { start: now.toISOString() } },
          'Agent': { relation: [{ id: d.agentId }] },
          'PIN verifie': { checkbox: true },
          'GPS': { rich_text: [{ text: { content: d.gps || 'Non disponible' } }] },
          'Statut vacation': { select: { name: d.type === 'Debut de service' ? 'En poste' : 'Termine' } }
        }
      };
      if (d.prestationId) page.properties['Prestation'] = { relation: [{ id: d.prestationId }] };
      if (d.siteId) page.properties['Site'] = { relation: [{ id: d.siteId }] };

      notionRequest('POST', 'pages', page)
        .then(function(result) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, pageUrl: result.url }));
        })
        .catch(function(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        });
    });
    return;
  }

  var filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);
  var ext = path.extname(filePath);
  var mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' };

  fs.readFile(filePath, function(err, content) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(content);
  });
});

server.listen(PORT, function() {
  console.log('Jet Guards demarre sur le port ' + PORT);
});
