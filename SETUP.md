# 🎵 Waveshare — Setup Guide

Get your real Spotify social listening app running in ~15 minutes.

---

## Step 1 — Add your Client Secret to the .env file

You already have your **Client ID** from the screenshot:
```
ab340ef067c840fa8a96e9172a525d65
```

Now get your **Client Secret**:
1. Go to https://developer.spotify.com/dashboard
2. Click your **Waveshare** app
3. Click **"View client secret"** — copy it

Now open `backend/.env.example`, rename it to `backend/.env`, and fill it in:
```
SPOTIFY_CLIENT_ID=ab340ef067c840fa8a96e9172a525d65
SPOTIFY_CLIENT_SECRET=<paste your secret here>
REDIRECT_URI=http://localhost:4000/api/auth/spotify/callback
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=pick-any-long-random-string-here
PORT=4000
```

---

## Step 2 — Add the Redirect URI in Spotify Dashboard

1. In your Spotify app dashboard, click **Edit Settings**
2. Under **Redirect URIs**, add:
   ```
   http://localhost:4000/api/auth/spotify/callback
   ```
3. Click **Add**, then **Save**

---

## Step 3 — Install & Run the Backend

You need **Node.js** installed (https://nodejs.org — get the LTS version).

Open a terminal in the `backend/` folder:
```bash
cd backend
npm install
npm start
```

You should see:
```
🎵 Waveshare backend running on http://localhost:4000
   Login URL: http://localhost:4000/api/auth/spotify
```

---

## Step 4 — Serve the Frontend

Open a **second terminal** in the `frontend/` folder. You can use any static server:

```bash
# Option A — Python (no install needed, macOS/Linux)
cd frontend
python3 -m http.server 3000

# Option B — Node (install once globally)
npm install -g serve
serve frontend -p 3000
```

---

## Step 5 — Open the App

Go to: **http://localhost:3000**

Click **"Continue with Spotify"** → log in → you're in! 🎉

---

## What's Working

| Feature | Data Source |
|---|---|
| Now Playing | Spotify API — your current track in real time |
| Feed / Recent | Your last 20 played tracks with timestamps |
| Top Charts | Your top 10 tracks & artists (4 weeks / 6 months / all time) |
| Profile | Your Spotify profile, followers, country |
| Following | Artists you follow on Spotify |
| Sidebar | Followed artists shown as "friends" panel |

> **Note on Friends**: Spotify removed their public friends API in 2023.
> The sidebar shows artists you follow as a stand-in. A true social layer
> would need a database (e.g. Supabase) to store friend connections — ask
> me to scaffold that if you want to go further!

---

## Deploying Online (Optional)

### Backend → Railway or Render (free tier)
1. Push the `backend/` folder to a GitHub repo
2. Connect it to https://railway.app or https://render.com
3. Add your `.env` variables in their dashboard
4. Get your backend URL (e.g. `https://waveshare.railway.app`)

### Frontend → Netlify or Vercel (free)
1. Update `const API` in `index.html` to your deployed backend URL
2. Drag the `frontend/` folder to https://netlify.com/drop

### Update Spotify Dashboard
Add your production callback URL to the Spotify app's Redirect URIs:
```
https://your-backend.railway.app/api/auth/spotify/callback
```
