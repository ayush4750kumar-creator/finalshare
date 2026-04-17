const express = require('express');
const cors = require('cors');
const axios = require('axios');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || `http://127.0.0.1:${PORT}`;

// ─── In-memory state stores ────────────────────────────────────────────────────
const oauthStates = new Map();

// Social user store: userId → { profile, accessToken, refreshToken, tokenExpiry, following: Set }
const userStore = new Map();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'waveshare-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24, sameSite: 'lax' }
}));

// ─── Serve frontend static files ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Spotify Config ───────────────────────────────────────────────────────────
const SPOTIFY_CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI          = process.env.REDIRECT_URI || `http://127.0.0.1:${PORT}/api/auth/spotify/callback`;

const SCOPES = [
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-read-playback-state',
  'user-top-read',
  'user-read-private',
  'user-read-email',
  'user-follow-read',
  'user-follow-modify'
].join(' ');

// ─── Token Helpers ────────────────────────────────────────────────────────────
async function refreshAccessToken(refreshToken) {
  const res = await axios.post('https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
      }
    }
  );
  return res.data;
}

async function spotifyGet(tokenObj, endpoint) {
  // tokenObj can be a session or a stored user object — both have same shape
  if (Date.now() > tokenObj.tokenExpiry) {
    const tokens = await refreshAccessToken(tokenObj.refreshToken);
    tokenObj.accessToken = tokens.access_token;
    tokenObj.tokenExpiry = Date.now() + tokens.expires_in * 1000;
    if (tokens.refresh_token) tokenObj.refreshToken = tokens.refresh_token;

    // Also update userStore if this is a stored user
    if (tokenObj.userId && userStore.has(tokenObj.userId)) {
      const stored = userStore.get(tokenObj.userId);
      stored.accessToken = tokenObj.accessToken;
      stored.tokenExpiry = tokenObj.tokenExpiry;
      stored.refreshToken = tokenObj.refreshToken;
    }
  }
  const res = await axios.get(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${tokenObj.accessToken}` }
  });
  return res.data;
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.get('/api/auth/spotify', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now());
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get('/api/auth/spotify/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${FRONTEND_URL}?error=${error}`);
  if (!state || !oauthStates.has(state)) return res.redirect(`${FRONTEND_URL}?error=state_mismatch`);
  oauthStates.delete(state);

  try {
    const tokenRes = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
        }
      }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    req.session.accessToken  = access_token;
    req.session.refreshToken = refresh_token;
    req.session.tokenExpiry  = Date.now() + expires_in * 1000;

    const profile = await spotifyGet(req.session, '/me');
    req.session.userId   = profile.id;
    req.session.userName = profile.display_name;
    req.session.userImg  = profile.images?.[0]?.url || null;

    // Store in social user store (preserve existing follows)
    const existing = userStore.get(profile.id) || {};
    userStore.set(profile.id, {
      userId: profile.id,
      profile: {
        id: profile.id,
        name: profile.display_name,
        image: profile.images?.[0]?.url || null,
        followers: profile.followers?.total || 0,
        country: profile.country
      },
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiry: Date.now() + expires_in * 1000,
      following: existing.following || new Set(),
      lastSeen: Date.now()
    });

    res.redirect(`${FRONTEND_URL}?loggedIn=true`);
  } catch (err) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    res.redirect(`${FRONTEND_URL}?error=auth_failed`);
  }
});

app.get('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ─── Auth Guard ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.accessToken) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ─── Core API Routes ──────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    loggedIn: !!req.session.accessToken,
    user: req.session.accessToken ? { id: req.session.userId, name: req.session.userName, image: req.session.userImg } : null
  });
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const profile = await spotifyGet(req.session, '/me');
    res.json({
      id: profile.id,
      name: profile.display_name,
      email: profile.email,
      image: profile.images?.[0]?.url || null,
      followers: profile.followers?.total || 0,
      country: profile.country
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/now-playing', requireAuth, async (req, res) => {
  try {
    const data = await spotifyGet(req.session, '/me/player/currently-playing');
    if (!data || !data.item) return res.json({ playing: false });
    res.json({
      playing: data.is_playing,
      track: {
        id: data.item.id,
        name: data.item.name,
        artist: data.item.artists.map(a => a.name).join(', '),
        album: data.item.album.name,
        image: data.item.album.images?.[0]?.url || null,
        duration_ms: data.item.duration_ms,
        progress_ms: data.progress_ms,
        url: data.item.external_urls.spotify
      }
    });
  } catch (err) {
    res.json({ playing: false });
  }
});

app.get('/api/recent', requireAuth, async (req, res) => {
  try {
    const data = await spotifyGet(req.session, '/me/player/recently-played?limit=30');
    const tracks = data.items.map(item => ({
      id: item.track.id,
      name: item.track.name,
      artist: item.track.artists.map(a => a.name).join(', '),
      album: item.track.album.name,
      image: item.track.album.images?.[1]?.url || null,
      played_at: item.played_at,
      url: item.track.external_urls.spotify
    }));
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/top-tracks', requireAuth, async (req, res) => {
  const range = req.query.range || 'short_term';
  try {
    const data = await spotifyGet(req.session, `/me/top/tracks?limit=10&time_range=${range}`);
    const tracks = data.items.map((t, i) => ({
      rank: i + 1,
      id: t.id,
      name: t.name,
      artist: t.artists.map(a => a.name).join(', '),
      image: t.album.images?.[1]?.url || null,
      popularity: t.popularity,
      url: t.external_urls.spotify
    }));
    res.json({ tracks, range });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/top-artists', requireAuth, async (req, res) => {
  const range = req.query.range || 'short_term';
  try {
    const data = await spotifyGet(req.session, `/me/top/artists?limit=6&time_range=${range}`);
    const artists = data.items.map((a, i) => ({
      rank: i + 1, id: a.id, name: a.name,
      genres: a.genres.slice(0, 2),
      image: a.images?.[0]?.url || null,
      followers: a.followers?.total || 0,
      popularity: a.popularity,
      url: a.external_urls.spotify
    }));
    res.json({ artists, range });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Social Routes ────────────────────────────────────────────────────────────

// List all users on the platform (for discovery)
app.get('/api/social/users', requireAuth, async (req, res) => {
  const myId = req.session.userId;
  const users = [];
  for (const [id, user] of userStore.entries()) {
    if (id === myId) continue;
    users.push({
      id: user.profile.id,
      name: user.profile.name,
      image: user.profile.image,
      lastSeen: user.lastSeen
    });
  }
  // Sort by most recently active
  users.sort((a, b) => b.lastSeen - a.lastSeen);
  res.json({ users });
});

// Get users you follow + their now-playing
app.get('/api/social/friends', requireAuth, async (req, res) => {
  const myId = req.session.userId;
  const me = userStore.get(myId);
  if (!me) return res.json({ friends: [] });

  const friends = [];
  for (const friendId of me.following) {
    const friend = userStore.get(friendId);
    if (!friend) continue;

    let nowPlaying = null;
    try {
      const np = await spotifyGet(friend, `/me/player/currently-playing`);
      if (np && np.item && np.is_playing) {
        nowPlaying = {
          playing: true,
          name: np.item.name,
          artist: np.item.artists.map(a => a.name).join(', '),
          image: np.item.album.images?.[0]?.url || null,
          url: np.item.external_urls.spotify,
          progress_ms: np.progress_ms,
          duration_ms: np.item.duration_ms
        };
      }
    } catch (e) { /* token issues or no playback */ }

    friends.push({
      id: friend.profile.id,
      name: friend.profile.name,
      image: friend.profile.image,
      nowPlaying,
      lastSeen: friend.lastSeen
    });
  }

  res.json({ friends });
});

// Follow a user
app.post('/api/social/follow/:userId', requireAuth, (req, res) => {
  const myId = req.session.userId;
  const me = userStore.get(myId);
  if (!me) return res.status(400).json({ error: 'User not found in store' });
  if (!userStore.has(req.params.userId)) return res.status(404).json({ error: 'Target user not found' });

  me.following.add(req.params.userId);
  res.json({ success: true, following: [...me.following] });
});

// Unfollow a user
app.delete('/api/social/follow/:userId', requireAuth, (req, res) => {
  const myId = req.session.userId;
  const me = userStore.get(myId);
  if (!me) return res.status(400).json({ error: 'User not found in store' });

  me.following.delete(req.params.userId);
  res.json({ success: true, following: [...me.following] });
});

// Get who I'm following (IDs)
app.get('/api/social/following-ids', requireAuth, (req, res) => {
  const me = userStore.get(req.session.userId);
  res.json({ following: me ? [...me.following] : [] });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵 Waveshare backend running on port ${PORT}`);
  console.log(`   FRONTEND_URL: ${FRONTEND_URL}`);
  console.log(`   REDIRECT_URI: ${REDIRECT_URI}\n`);
});