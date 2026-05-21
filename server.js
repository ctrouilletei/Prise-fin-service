const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const AGENTS_DB    = '214a12376ab3802d86a0c166920a50c3';
const PRESTAS_DB   = '328a12376ab380f2926dd048912c453b';
const POINTAGES_DB = 'b0b4acfd6dac4d06a41d66c658675d8c';
const SITES_DB     = '26aa12376ab3803296ece3863941f299';

function notionRequest(method, endpoint, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? Buffer.from(JSON.stringify(body)) : null;
    var options = {
      hostname: 'api.notion.com', port: 443,
      path: '/v1/' + endpoint, method: method,
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
      res.on('end', function() { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
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
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /api/agents?site=ID
  if (req.method === 'GET' && pathname === '/api/agents') {
    var params = new URLSearchParams(parsed.query || '');
    var siteId = params.get('site');
    var today = new Date().toISOString().split('T')[0];

    if (siteId) {
      // Charge les infos du site (GPS + rayon) en parallèle avec les prestations
      Promise.all([
        notionRequest('GET', 'pages/' + siteId, null),
        notionRequest('POST', 'databases/' + PRESTAS_DB + '/query', {
          filter: {and: [
            {property: '🏟️ Sites des missions', relation: {contains: siteId}},
            {property: 'Période de prestation', date: {on_or_before: new Date().toISOString()}},
            {property: 'Période de prestation', date: {on_or_after: today + 'T00:00:00.000Z'}}
          ]}, page_size: 20
        })
      ]).then(function(results) {
        var sitePage = results[0];
        var siteProps = sitePage.properties || {};
        var siteLat = siteProps['GPS Latitude'] && siteProps['GPS Latitude'].number;
        var siteLng = siteProps['GPS Longitude'] && siteProps['GPS Longitude'].number;
        var siteRayon = siteProps['Rayon autorisé (m)'] && siteProps['Rayon autorisé (m)'].number || 500;

        var prestas = (results[1].results || []).filter(function(p) {
          var d = p.properties['Période de prestation'] && p.properties['Période de prestation'].date;
          if (!d || !d.start) return false;
          var s = d.start.split('T')[0], e = d.end ? d.end.split('T')[0] : s;
          return s <= today && today <= e;
        });

        if (!prestas.length) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({agents: [], siteGps: null, message: 'Aucune prestation active'}));
          return;
        }

        var agentMap = {};
        prestas.forEach(function(pr) {
          var rel = pr.properties['Agents'] && pr.properties['Agents'].relation ? pr.properties['Agents'].relation : [];
          var nom = pr.properties['Nom'] && pr.properties['Nom'].title && pr.properties['Nom'].title[0] ? pr.properties['Nom'].title[0].plain_text : '';
          rel.forEach(function(a) { agentMap[a.id] = {prestationId: pr.id, prestationNom: nom}; });
        });

        var ids = Object.keys(agentMap);
        if (!ids.length) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({agents: [], siteGps: null, message: 'Aucun agent affecté'}));
          return;
        }

        var siteGps = (siteLat && siteLng) ? {lat: siteLat, lng: siteLng, rayon: siteRayon} : null;
        var batches = [], i;
        for (i = 0; i < ids.length; i += 10) batches.push(ids.slice(i, i + 10));
        var all = [], done = 0;
        batches.forEach(function(batch) {
          Promise.all(batch.map(function(id) { return notionRequest('GET', 'pages/' + id, null); }))
            .then(function(pages) {
              pages.forEach(function(p) {
                if (!p || !p.properties) return;
                var nom = p.properties['Nom'] && p.properties['Nom'].title && p.properties['Nom'].title[0] ? p.properties['Nom'].title[0].plain_text : '';
                if (!nom) return;
                var pr = agentMap[p.id] || {};
                all.push({id: p.id, nom: nom, prestationId: pr.prestationId, prestationNom: pr.prestationNom});
              });
              done++;
              if (done === batches.length) {
                all.sort(function(a, b) { return a.nom.localeCompare(b.nom); });
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({agents: all, siteGps: siteGps}));
              }
            }).catch(function() {
              done++;
              if (done === batches.length) {
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({agents: all, siteGps: siteGps}));
              }
            });
        });
      }).catch(function(e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: e.message, agents: []}));
      });
    } else {
      var all = [];
      function fetchPage(cur) {
        var body = {page_size: 100};
        if (cur) body.start_cursor = cur;
        notionRequest('POST', 'databases/' + AGENTS_DB + '/query', body).then(function(result) {
          (result.results || []).forEach(function(p) {
            var nom = p.properties['Nom'] && p.properties['Nom'].title && p.properties['Nom'].title[0] ? p.properties['Nom'].title[0].plain_text : '';
            if (nom) all.push({id: p.id, nom: nom});
          });
          if (result.has_more && result.next_cursor) {
            fetchPage(result.next_cursor);
          } else {
            all.sort(function(a, b) { return a.nom.localeCompare(b.nom); });
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({agents: all, siteGps: null}));
          }
        }).catch(function(e) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error: e.message, agents: []}));
        });
      }
      fetchPage(null);
    }
    return;
  }

  // GET /api/check?agentId=ID&type=debut|fin
  if (req.method === 'GET' && pathname === '/api/check') {
    var params2 = new URLSearchParams(parsed.query || '');
    var agentId = params2.get('agentId');
    var type = params2.get('type');
    var today2 = new Date().toISOString().split('T')[0];
    var typeLabel = type === 'debut' ? 'Début de service' : 'Fin de service';
    notionRequest('POST', 'databases/' + POINTAGES_DB + '/query', {
      filter: {and: [
        {property: 'Agent', relation: {contains: agentId}},
        {property: 'Horodatage', date: {on_or_after: today2 + 'T00:00:00.000Z'}},
        {property: 'Type', select: {equals: typeLabel}}
      ]}, page_size: 1
    }).then(function(result) {
      var found = result.results && result.results.length > 0;
      var heure = found ? new Date(result.results[0].properties['Horodatage'].date.start).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : null;
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({alreadyPointed: found, heure: heure}));
    }).catch(function() {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({alreadyPointed: false}));
    });
    return;
  }

  // POST /api/pointage
  if (req.method === 'POST' && pathname === '/api/pointage') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      var d;
      try { d = JSON.parse(body); } catch(e) { res.writeHead(400); res.end('Bad request'); return; }
      var now = new Date(d.horodatage || new Date());
      var page = {
        parent: {database_id: POINTAGES_DB},
        properties: {
          'Nom':             {title: [{text: {content: d.nom}}]},
          'Type':            {select: {name: d.type}},
          'Horodatage':      {date: {start: now.toISOString()}},
          'Agent':           {relation: [{id: d.agentId}]},
          'GPS':             {rich_text: [{text: {content: d.gps || 'Non disponible'}}]},
          'Statut vacation': {select: {name: d.type === 'Début de service' ? 'En poste' : 'Terminé'}}
        }
      };
      if (d.siteId) page.properties['Site'] = {relation: [{id: d.siteId}]};
      notionRequest('POST', 'pages', page).then(function(result) {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: true}));
      }).catch(function(e) {
        console.error('Erreur creation page:', e.message);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({success: false, error: e.message}));
      });
    });
    return;
  }

  // Fichiers statiques
  var filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);
  var ext = path.extname(filePath);
  var mime = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json'};
  fs.readFile(filePath, function(err, content) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': mime[ext] || 'text/plain'});
    res.end(content);
  });
});

server.listen(PORT, function() { console.log('Jet Guards demarre sur le port ' + PORT); });
