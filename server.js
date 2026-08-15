const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Если запущено на Render — используем диск /var/data/data.json, иначе локальный файл
const DATA_FILE = process.env.RENDER
  ? '/var/data/data.json'
  : path.join(__dirname, 'data.json');

const DEFAULT_PASSWORD = 'vault2026';

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initial = {
        games: [],
        votes: [],
        admin: { password: DEFAULT_PASSWORD }
      };
      fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    data.games ||= [];
    data.votes ||= [];
    data.admin ||= { password: DEFAULT_PASSWORD };
    data.admin.password ||= DEFAULT_PASSWORD;
    return data;
  } catch (e) {
    console.error('Failed to read data.json:', e.message);
    process.exit(1);
  }
}

let data = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function checkAdmin(req, res, next) {
  const pw = req.headers['x-admin-password'];
  if (!pw || pw !== data.admin.password) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---- Public: list games ----
app.get('/api/games', (req, res) => {
  res.json(data.games);
});

// ---- Admin: add game ----
app.post('/api/games', checkAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const game = {
      id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: String(body.name || '').trim(),
      weight: Number(body.weight) || 0,
      genres: Array.isArray(body.genres) ? body.genres : [],
      platforms: Array.isArray(body.platforms) ? body.platforms : [],
      photo: String(body.photo || '').trim(),
      downloadLink: String(body.downloadLink || '').trim(),
      description: String(body.description || '').trim(),
      likes: 0,
      dislikes: 0
    };

    if (!game.name) return res.status(400).json({ error: 'name required' });

    data.games.push(game);
    saveData();
    res.json(game);
  } catch (e) {
    res.status(500).json({ error: 'storage error' });
  }
});

// ---- Admin: delete game ----
app.delete('/api/games/:id', checkAdmin, (req, res) => {
  try {
    data.games = data.games.filter(g => g.id !== req.params.id);
    data.votes = data.votes.filter(v => v.gameId !== req.params.id);
    saveData();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'storage error' });
  }
});

// ---- Admin: login check ----
app.post('/api/admin/login', (req, res) => {
  if (req.body && req.body.password === data.admin.password) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

// ---- Admin: change password ----
app.post('/api/admin/password', checkAdmin, (req, res) => {
  try {
    const newPw = String((req.body && req.body.newPassword) || '').trim();
    if (!newPw) return res.status(400).json({ error: 'empty password' });
    data.admin.password = newPw;
    saveData();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'storage error' });
  }
});

// ---- Public: this voter's votes across all games ----
app.get('/api/votes/:voterId', (req, res) => {
  const result = {};
  data.votes
    .filter(v => v.voterId === req.params.voterId)
    .forEach(v => { result[v.gameId] = v.type; });
  res.json(result);
});

// ---- Public: cast/change/remove a vote ----
app.post('/api/games/:id/vote', (req, res) => {
  try {
    const { voterId, type } = req.body || {};
    if (!voterId || !['like', 'dislike'].includes(type)) {
      return res.status(400).json({ error: 'bad request' });
    }

    const game = data.games.find(g => g.id === req.params.id);
    if (!game) return res.status(404).json({ error: 'not found' });

    const index = data.votes.findIndex(v => v.gameId === req.params.id && v.voterId === voterId);
    const existingVote = index >= 0 ? data.votes[index] : null;
    const current = existingVote ? existingVote.type : null;
    let newVote = type;

    if (current === type) {
      if (type === 'like') game.likes = Math.max(0, (game.likes || 0) - 1);
      else game.dislikes = Math.max(0, (game.dislikes || 0) - 1);
      data.votes.splice(index, 1);
      newVote = null;
    } else {
      if (current === 'like') game.likes = Math.max(0, (game.likes || 0) - 1);
      if (current === 'dislike') game.dislikes = Math.max(0, (game.dislikes || 0) - 1);

      if (type === 'like') game.likes = (game.likes || 0) + 1;
      else game.dislikes = (game.dislikes || 0) + 1;

      const vote = { gameId: req.params.id, voterId, type };
      if (index >= 0) data.votes[index] = vote;
      else data.votes.push(vote);
    }

    saveData();
    res.json({
      likes: Math.max(0, game.likes || 0),
      dislikes: Math.max(0, game.dislikes || 0),
      vote: newVote
    });
  } catch (e) {
    res.status(500).json({ error: 'storage error' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index (1).html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Kepka running on port ' + PORT));
