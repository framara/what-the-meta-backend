const express = require('express');
const router = express.Router();
const { getUserTokenFromCode } = require('../services/blizzard/auth');

// Endpoint para redirigir al login de Blizzard con el scope wow.profile
router.get('/blizzard/login', (req, res) => {
  const clientId = process.env.BLIZZARD_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.BLIZZARD_REDIRECT_URI);
  const scope = encodeURIComponent('wow.profile');
  const state = Math.random().toString(36).substring(2);
  const authUrl = `https://oauth.battle.net/authorize?client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}&response_type=code&state=${state}`;
  res.redirect(authUrl);
});

// Endpoint de callback para recibir el code y obtener el user access token
router.get('/blizzard/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');
  try {
    const accessToken = await getUserTokenFromCode(code, 'us');
    global.LAST_USER_ACCESS_TOKEN = accessToken;
    res.send('User access token obtained and stored in global.LAST_USER_ACCESS_TOKEN. Ya puedes usar endpoints /profile/.');
  } catch (err) {
    res.status(500).send('Error exchanging code for token: ' + err.message);
  }
});

module.exports = router; 