# Jet Guards — Prise de Service

Application de pointage agents via QR code, reliée à Notion.

## Structure

```
jet-guards-app/
├── server.js        ← Serveur Node.js (proxy API)
├── package.json     ← Config Node
├── public/
│   └── index.html   ← Application mobile
└── README.md
```

## Déploiement sur Railway

1. Push ce dossier sur GitHub
2. Railway → New Project → Deploy from GitHub
3. Ajouter la variable d'environnement :
   - `ANTHROPIC_API_KEY` = ta clé API Anthropic
4. Railway démarre automatiquement avec `npm start`

## Format QR code par site

```
https://ton-app.railway.app?site=ID_NOTION_DU_SITE&nom=Nom%20Du%20Site
```

L'ID du site se trouve dans l'URL Notion de chaque page de la base "Sites des missions".

## Exemple

Stade de France (ID: 26aa12376ab3803296ece3863941f299) :
```
https://ton-app.railway.app?site=26aa12376ab3803296ece3863941f299&nom=Stade%20de%20France
```
