const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

// Load .env file for local development
try { require('dotenv').config(); } catch(e) {}

const app = express();
const PORT = process.env.PORT || 3000;
const MOD_PASSWORD = process.env.MOD_PASSWORD || 'changeme';

// ---- MIDDLEWARE ----
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- MOD AUTH MIDDLEWARE ----
function requireMod(req, res, next) {
  const pw = req.headers['x-mod-password'] || req.query.mod_password;
  if (pw !== MOD_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---- DATABASE SETUP ----
const dbPath = process.env.RAILWAY_ENVIRONMENT ? '/app/data/shows.db' : 'shows.db';
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT DEFAULT 'TBA',
    venue TEXT,
    type TEXT,
    genre TEXT,
    age TEXT DEFAULT 'All ages',
    origin TEXT DEFAULT 'Local',
    neighborhood TEXT,
    staff_pick INTEGER DEFAULT 0,
    url TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    source TEXT DEFAULT 'submitted',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS saved_shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id INTEGER,
    user_id TEXT DEFAULT 'default',
    saved_at TEXT DEFAULT (datetime('now')),
    UNIQUE(show_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT DEFAULT 'default',
    pref_key TEXT,
    pref_value TEXT,
    UNIQUE(user_id, pref_key)
  );

  CREATE TABLE IF NOT EXISTS venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    neighborhood TEXT,
    website TEXT,
    calendar_url TEXT,
    active INTEGER DEFAULT 1
  );
`);

// ---- SEED VENUES ----
const seedVenues = [
  { name: 'Zebulon', neighborhood: 'Frogtown', website: 'https://www.zebulon.la', calendar_url: 'https://www.zebulon.la/events' },
  { name: 'Lodge Room', neighborhood: 'Highland Park', website: 'https://lodgeroom.com', calendar_url: 'https://lodgeroom.com/calendar' },
  { name: 'The Redwood', neighborhood: 'Downtown', website: 'https://theredwoodbar.com', calendar_url: 'https://theredwoodbar.com/calendar' },
  { name: "Alex's Bar", neighborhood: 'Long Beach', website: 'https://alexsbar.com', calendar_url: 'https://alexsbar.com/events' },
  { name: 'Permanent Records', neighborhood: 'Echo Park', website: 'https://permanentrecords.com', calendar_url: null },
  { name: 'EchoPlex', neighborhood: 'Echo Park', website: 'https://www.echolosangeles.com', calendar_url: 'https://www.echolosangeles.com/echoplex' },
  { name: 'Footsies', neighborhood: 'Boyle Heights', website: 'https://footsiesbar.com', calendar_url: null },
];

const insertVenue = db.prepare(`
  INSERT OR IGNORE INTO venues (name, neighborhood, website, calendar_url)
  VALUES (@name, @neighborhood, @website, @calendar_url)
`);
seedVenues.forEach(v => insertVenue.run(v));

// ---- SEED SHOWS (only if empty) ----
const showCount = db.prepare('SELECT COUNT(*) as cnt FROM shows').get();
if (showCount.cnt === 0) {
  function md(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }
  const seedShows = [
    { artist: 'Surfbort', date: md(0), time: '9pm', venue: 'EchoPlex', type: 'Band', genre: 'Punk', age: '21+', origin: 'Touring', neighborhood: 'Echo Park', staff_pick: 1, url: '#', notes: 'w/ local openers TBA', status: 'live', source: 'seed' },
    { artist: 'DJ Haram', date: md(0), time: '10pm', venue: 'Zebulon', type: 'DJ', genre: 'Club / Experimental', age: '21+', origin: 'Touring', neighborhood: 'Frogtown', staff_pick: 1, url: '#', notes: '', status: 'live', source: 'seed' },
    { artist: 'Negative Gemini', date: md(1), time: '9pm', venue: 'Lodge Room', type: 'Band', genre: 'Dream Pop', age: 'All ages', origin: 'Touring', neighborhood: 'Highland Park', staff_pick: 1, url: '#', notes: '', status: 'live', source: 'seed' },
    { artist: 'Biscuit Brown & Friends', date: md(2), time: '10pm', venue: 'Footsies', type: 'Dance', genre: 'Soul / Funk', age: '21+', origin: 'Local', neighborhood: 'Boyle Heights', staff_pick: 0, url: '#', notes: 'Monthly residency', status: 'live', source: 'seed' },
    { artist: 'Biblioteka', date: md(3), time: '9:30pm', venue: 'The Redwood', type: 'Band', genre: 'Garage / Punk', age: '21+', origin: 'Local', neighborhood: 'Downtown', staff_pick: 1, url: '#', notes: 'Record release show', status: 'live', source: 'seed' },
    { artist: 'Mannequin Pussy', date: md(5), time: '8pm', venue: 'EchoPlex', type: 'Band', genre: 'Indie Rock', age: 'All ages', origin: 'Touring', neighborhood: 'Echo Park', staff_pick: 1, url: '#', notes: '', status: 'live', source: 'seed' },
    { artist: 'Cha Cha Nights', date: md(6), time: '9pm', venue: 'Zebulon', type: 'Dance', genre: 'Latin / Cumbia', age: 'All ages', origin: 'Local', neighborhood: 'Frogtown', staff_pick: 1, url: '#', notes: '$5 cover', status: 'live', source: 'seed' },
    { artist: 'Spray Paint', date: md(8), time: '9pm', venue: "Alex's Bar", type: 'Band', genre: 'Post-Punk', age: '21+', origin: 'Touring', neighborhood: 'Long Beach', staff_pick: 0, url: '#', notes: '', status: 'live', source: 'seed' },
    // Pending demo submissions
    { artist: 'Haunted Summer', date: md(2), time: '9pm', venue: 'Lodge Room', type: 'Band', genre: 'Shoegaze', age: 'All ages', origin: 'Local', neighborhood: 'Highland Park', staff_pick: 0, url: 'https://lodgeroom.com', notes: 'Fan submission', status: 'pending', source: 'submitted' },
    { artist: 'Acid Mothers Temple', date: md(5), time: '8pm', venue: 'EchoPlex', type: 'Band', genre: 'Psychedelic', age: '21+', origin: 'Touring', neighborhood: 'Echo Park', staff_pick: 0, url: '', notes: 'Japanese psych legends', status: 'pending', source: 'submitted' },
  ];
  const insertShow = db.prepare(`
    INSERT INTO shows (artist, date, time, venue, type, genre, age, origin, neighborhood, staff_pick, url, notes, status, source)
    VALUES (@artist, @date, @time, @venue, @type, @genre, @age, @origin, @neighborhood, @staff_pick, @url, @notes, @status, @source)
  `);
  seedShows.forEach(s => insertShow.run(s));
}

// ---- MOD AUTH ENDPOINT ----
app.post('/api/mod/login', (req, res) => {
  const { password } = req.body;
  if (password === MOD_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Wrong password' });
  }
});

// ---- ROUTES: SHOWS ----

// Get all live shows
app.get('/api/shows', (req, res) => {
  const shows = db.prepare(`
    SELECT * FROM shows WHERE status = 'live' AND date >= date('now') ORDER BY date ASC
  `).all();
  res.json(shows);
});

// Get pending shows (mod queue) - PROTECTED
app.get('/api/shows/pending', requireMod, (req, res) => {
  const shows = db.prepare(`SELECT * FROM shows WHERE status = 'pending' ORDER BY created_at ASC`).all();
  res.json(shows);
});

// Submit a show (goes to pending)
app.post('/api/shows', (req, res) => {
  const { artist, date, time, venue, type, genre, age, origin, neighborhood, url, notes } = req.body;
  if (!artist || !date || !type) return res.status(400).json({ error: 'artist, date, and type are required' });
  const hood = neighborhood || (db.prepare('SELECT neighborhood FROM venues WHERE name = ?').get(venue) || {}).neighborhood || '';
  const result = db.prepare(`
    INSERT INTO shows (artist, date, time, venue, type, genre, age, origin, neighborhood, url, notes, status, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'submitted')
  `).run(artist, date, time || 'TBA', venue, type, genre || 'TBA', age || 'All ages', origin || 'Local', hood, url || '', notes || '');
  res.json({ id: result.lastInsertRowid, status: 'pending' });
});

// Approve a show - PROTECTED
app.patch('/api/shows/:id/approve', requireMod, (req, res) => {
  const { staff_pick } = req.body;
  db.prepare(`UPDATE shows SET status = 'live', staff_pick = ? WHERE id = ?`)
    .run(staff_pick ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// Reject a show - PROTECTED
app.patch('/api/shows/:id/reject', requireMod, (req, res) => {
  db.prepare(`UPDATE shows SET status = 'rejected' WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

// Update a show - PROTECTED
app.put('/api/shows/:id', requireMod, (req, res) => {
  const { artist, date, time, venue, type, genre, age, origin, neighborhood, url, notes } = req.body;
  db.prepare(`
    UPDATE shows SET artist=?, date=?, time=?, venue=?, type=?, genre=?, age=?, origin=?, neighborhood=?, url=?, notes=?
    WHERE id=?
  `).run(artist, date, time, venue, type, genre, age, origin, neighborhood, url, notes, req.params.id);
  res.json({ success: true });
});

// Delete a show - PROTECTED
app.delete('/api/shows/:id', requireMod, (req, res) => {
  db.prepare('DELETE FROM shows WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ---- ROUTES: SAVED SHOWS ----

app.get('/api/saved', (req, res) => {
  const userId = req.query.user_id || 'default';
  const saved = db.prepare(`
    SELECT s.* FROM shows s
    JOIN saved_shows ss ON s.id = ss.show_id
    WHERE ss.user_id = ?
  `).all(userId);
  res.json(saved);
});

app.post('/api/saved/:showId', (req, res) => {
  const userId = req.body.user_id || 'default';
  try {
    db.prepare('INSERT OR IGNORE INTO saved_shows (show_id, user_id) VALUES (?, ?)').run(req.params.showId, userId);
    res.json({ saved: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/saved/:showId', (req, res) => {
  const userId = req.query.user_id || 'default';
  db.prepare('DELETE FROM saved_shows WHERE show_id = ? AND user_id = ?').run(req.params.showId, userId);
  res.json({ saved: false });
});

// ---- ROUTES: PREFERENCES ----

app.get('/api/prefs', (req, res) => {
  const userId = req.query.user_id || 'default';
  const rows = db.prepare('SELECT pref_key, pref_value FROM preferences WHERE user_id = ?').all(userId);
  const prefs = {};
  rows.forEach(r => { prefs[r.pref_key] = JSON.parse(r.pref_value); });
  res.json(prefs);
});

app.post('/api/prefs', (req, res) => {
  const userId = req.body.user_id || 'default';
  const { prefs } = req.body;
  const upsert = db.prepare(`
    INSERT INTO preferences (user_id, pref_key, pref_value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, pref_key) DO UPDATE SET pref_value = excluded.pref_value
  `);
  const saveAll = db.transaction((p) => {
    Object.entries(p).forEach(([k, v]) => upsert.run(userId, k, JSON.stringify(v)));
  });
  saveAll(prefs);
  res.json({ success: true });
});

// ---- ROUTES: VENUES ----

app.get('/api/venues', (req, res) => {
  res.json(db.prepare('SELECT * FROM venues WHERE active = 1 ORDER BY name').all());
});

app.post('/api/venues', (req, res) => {
  const { name, neighborhood, website, calendar_url } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT OR IGNORE INTO venues (name, neighborhood, website, calendar_url) VALUES (?, ?, ?, ?)')
    .run(name, neighborhood || 'Los Angeles', website || '', calendar_url || null);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/venues/:id', (req, res) => {
  db.prepare('UPDATE venues SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ---- SCRAPERS ----

// Dice.fm venue IDs — add more as needed
const DICE_VENUES = [
  { diceId: 'zebulon-y8bv',     name: 'Zebulon',       neighborhood: 'Frogtown' },
  { diceId: 'the-smell-539ny',  name: 'The Smell',      neighborhood: 'Downtown' },
  { diceId: 'gold-diggers-n2mq',name: 'Gold-Diggers',   neighborhood: 'East Hollywood' },
];

// Lodgeroom scraper (they have a clean website)
async function scrapeLodgeRoom() {
  console.log('Scraping Lodge Room...');
  try {
    const { data } = await axios.get('https://www.lodgeroomhlp.com/', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(data);
    const shows = [];
    const today = new Date().toISOString().split('T')[0];

    // Lodge Room uses a list of events with date + title
    $('article, .event, .show, [class*="event"]').each((i, el) => {
      const title = $(el).find('h1,h2,h3,h4,a').first().text().trim();
      const dateEl = $(el).find('time,[class*="date"],.date').first();
      const dateStr = dateEl.attr('datetime') || dateEl.text().trim();
      const url = $(el).find('a').first().attr('href') || 'https://www.lodgeroomhlp.com';
      if (title && title.length > 2 && title.length < 120) {
        shows.push({ title, dateStr, url });
      }
    });

    return shows.slice(0, 25).map(s => ({
      artist: s.title,
      raw_date: s.dateStr,
      venue: 'Lodge Room',
      neighborhood: 'Highland Park',
      url: s.url.startsWith('http') ? s.url : 'https://www.lodgeroomhlp.com' + s.url,
      notes: '',
    }));
  } catch (err) {
    console.error(`Failed to scrape Lodge Room: ${err.message}`);
    return [];
  }
}

// Dice.fm scraper — uses their public venue page
async function scrapeDice(diceVenue) {
  console.log(`Scraping Dice: ${diceVenue.name}...`);
  try {
    const url = `https://dice.fm/venue/${diceVenue.diceId}`;
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    });

    const $ = cheerio.load(data);
    const shows = [];

    // Extract JSON-LD structured data (Dice embeds venue + events in block 0)
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const json = JSON.parse($(el).html());
        // Block 0 is a Place with an "event" array
        const events = json.event || (json['@type'] === 'MusicEvent' || json['@type'] === 'Event' ? [json] : []);
        const allEvents = Array.isArray(events) ? events : [events];
        allEvents.forEach(e => {
          if (!e || (!e.name && !e.startDate)) return;
          const name = e.name || '';
          const startDate = e.startDate || e.doorTime || '';
          const eventUrl = e.url || e['@id'] || url;
          const performer = e.performer;
          const artistName = Array.isArray(performer)
            ? performer.map(p => p.name || p).join(' / ')
            : (performer && performer.name ? performer.name : name);
          if ((artistName || name) && startDate) {
            shows.push({ artist: artistName || name, raw_date: startDate, url: eventUrl });
          }
        });
      } catch (e) {}
    });

    // Fallback: parse visible event listings
    if (shows.length === 0) {
      $('[class*="event"], [class*="Event"], li').each((i, el) => {
        const title = $(el).find('h1,h2,h3,h4,[class*="title"],[class*="name"]').first().text().trim();
        const dateEl = $(el).find('time,[class*="date"],[class*="Date"]').first();
        const dateStr = dateEl.attr('datetime') || dateEl.text().trim();
        const eventUrl = $(el).find('a').first().attr('href') || url;
        if (title && title.length > 2 && title.length < 120) {
          shows.push({ artist: title, raw_date: dateStr, url: eventUrl.startsWith('http') ? eventUrl : 'https://dice.fm' + eventUrl });
        }
      });
    }

    return shows.slice(0, 30).map(s => ({
      ...s,
      venue: diceVenue.name,
      neighborhood: diceVenue.neighborhood,
      notes: '',
    }));
  } catch (err) {
    console.error(`Failed to scrape Dice ${diceVenue.name}: ${err.message}`);
    return [];
  }
}

// Zebulon direct scraper (their site is WordPress-based)
async function scrapeZebulon() {
  console.log('Scraping Zebulon...');
  try {
    const { data } = await axios.get('https://zebulon.la/', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(data);
    const shows = [];

    // Zebulon uses WordPress with tribe events or similar
    $('article, .tribe_events_cat, .type-tribe_events, [class*="event"]').each((i, el) => {
      const title = $(el).find('h1,h2,h3,h4,.tribe-event-url,.entry-title').first().text().trim();
      const dateEl = $(el).find('time,.tribe-event-date-start,[class*="date"]').first();
      const dateStr = dateEl.attr('datetime') || dateEl.text().trim();
      const eventUrl = $(el).find('a').first().attr('href') || 'https://zebulon.la';
      if (title && title.length > 2 && title.length < 120) {
        shows.push({ artist: title, raw_date: dateStr, url: eventUrl, venue: 'Zebulon', neighborhood: 'Frogtown', notes: '' });
      }
    });

    return shows.slice(0, 25);
  } catch (err) {
    console.error(`Failed to scrape Zebulon: ${err.message}`);
    return [];
  }
}

function detectType(text) {
  const t = text.toLowerCase();
  if (/screening|film|movie|cinema|short film|documentary/i.test(t)) return 'Art';
  if (/dj|dance party|club night|discotheque|rave|techno night|house night/i.test(t)) return 'DJ';
  if (/cumbia|salsa|reggaeton|latin night|dance night|dancehall|baile/i.test(t)) return 'Dance';
  if (/karaoke/i.test(t)) return 'Karaoke';
  if (/art show|gallery|exhibition|opening|art opening|mural/i.test(t)) return 'Art';
  return 'Band';
}

function detectGenre(text) {
  const t = text.toLowerCase();
  if (/punk|hardcore|oi!/i.test(t)) return 'Punk';
  if (/garage/i.test(t)) return 'Garage';
  if (/cumbia|salsa|latin|reggaeton/i.test(t)) return 'Latin / Cumbia';
  if (/jazz/i.test(t)) return 'Jazz';
  if (/hip.?hop|rap/i.test(t)) return 'Hip Hop';
  if (/electronic|techno|house|rave|edm/i.test(t)) return 'Electronic';
  if (/folk|country|bluegrass/i.test(t)) return 'Folk / Country';
  if (/metal|doom|black metal|death metal/i.test(t)) return 'Metal';
  if (/soul|funk|r&b|rnb/i.test(t)) return 'Soul / Funk';
  if (/indie|alt/i.test(t)) return 'Indie / Alt';
  if (/shoegaze|dream pop/i.test(t)) return 'Shoegaze / Dream Pop';
  if (/post.?punk/i.test(t)) return 'Post-Punk';
  if (/psychedelic|psych/i.test(t)) return 'Psychedelic';
  if (/experimental/i.test(t)) return 'Experimental';
  if (/screening|film|movie/i.test(t)) return 'Film';
  return 'TBA';
}

function parseDate(raw) {
  if (!raw) return null;
  try {
    // Handle ISO format from JSON-LD (e.g. "2026-07-10T20:00:00")
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch (e) {}
  // Try parsing "Mon, Jul 10" style dates
  try {
    const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const match = raw.match(/([A-Za-z]{3})[,\s]+(\d{1,2})/);
    if (match) {
      const month = months[match[1]];
      const day = parseInt(match[2]);
      const year = new Date().getFullYear();
      const d = new Date(year, month, day);
      // If date is in the past by more than 30 days, it's probably next year
      if (d < new Date(Date.now() - 30 * 86400000)) d.setFullYear(year + 1);
      return d.toISOString().split('T')[0];
    }
  } catch (e) {}
  return null;
}

// Permanent Records Roadhouse scraper
async function scrapePermanentRoadhouse() {
  console.log('Scraping Permanent Records Roadhouse...');
  try {
    const { data } = await axios.get('http://roadhouse.permanentrecordsla.com/', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(data);
    const shows = [];
    const currentYear = new Date().getFullYear();

    // Their site lists events as plain text blocks with dates like "Friday, June 13th - 9PM Artist Name"
    $('body').find('p, div, li, td').each((i, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      // Match patterns like "Friday, June 13th" or "Saturday, June 14th - 8PM"
      const dateMatch = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
      if (!dateMatch) return;

      const month = dateMatch[1];
      const day = parseInt(dateMatch[2]);
      const timeMatch = text.match(/[-–]\s*(\d{1,2}(?::\d{2})?(?:AM|PM)?)/i);
      const time = timeMatch ? timeMatch[1] : 'TBA';

      // Extract artist name — text after the time or date
      let artist = text.replace(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?/i, '').replace(/[-–]\s*\d{1,2}(?::\d{2})?(?:AM|PM)?/i, '').trim();
      artist = artist.replace(/Buy tickets?!?/i, '').replace(/FREE RSVP/i, '').trim();

      const url = $(el).find('a').first().attr('href') || 'http://roadhouse.permanentrecordsla.com';

      if (artist && artist.length > 2 && artist.length < 150) {
        shows.push({
          artist,
          raw_date: `${month} ${day} ${currentYear}`,
          time,
          venue: 'Permanent Records Roadhouse',
          neighborhood: 'Echo Park',
          url: url.startsWith('http') ? url : 'http://roadhouse.permanentrecordsla.com' + url,
          notes: ''
        });
      }
    });

    return shows.slice(0, 30);
  } catch (err) {
    console.error(`Failed to scrape Permanent Records Roadhouse: ${err.message}`);
    return [];
  }
}

// KCRW concert calendar scraper
async function scrapeKCRW() {
  console.log('Scraping KCRW...');
  try {
    // Use the music page which has a cleaner concert listing
    const { data } = await axios.get('https://www.kcrw.com/music', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
      }
    });
    const $ = cheerio.load(data);
    const shows = [];
    const currentYear = new Date().getFullYear();

    // KCRW music page lists concerts in a section with date + title + venue
    $('li, article, .event-item, [class*="concert"]').each((i, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      // Match "Jun 19" or "Jul 22" date pattern
      const dateMatch = text.match(/([A-Za-z]{3})\s+(\d{1,2})/);
      if (!dateMatch) return;

      const month = dateMatch[1];
      const day = dateMatch[2];

      // Title is in bold/heading
      const title = $(el).find('strong, b, h2, h3, h4, a').first().text().trim();
      if (!title || title.length < 3 || title.length > 150) return;

      // Skip non-music events
      const lowerText = text.toLowerCase();
      const isMusic = lowerText.includes('kcrw presents') || lowerText.includes('concert') || lowerText.includes('indie') || lowerText.includes('alt') || lowerText.includes('electronic') || lowerText.includes('shoegaze') || lowerText.includes('hip-hop');
      if (!isMusic) return;

      // Extract venue
      const venueMatch = text.match(/·\s*([^·]+),\s*Los Angeles/);
      const venue = venueMatch ? venueMatch[1].trim() : 'Los Angeles';

      const url = $(el).find('a').first().attr('href') || 'https://www.kcrw.com/music';

      shows.push({
        artist: title,
        raw_date: `${month} ${day} ${currentYear}`,
        venue,
        neighborhood: 'Los Angeles',
        url: url.startsWith('http') ? url : 'https://www.kcrw.com' + url,
        notes: 'KCRW Presents',
        staff_pick: 1
      });
    });

    console.log(`KCRW: found ${shows.length} shows`);
    return shows.slice(0, 40);
  } catch (err) {
    console.error(`Failed to scrape KCRW: ${err.message}`);
    return [];
  }
}

async function runScraper() {
  console.log('Running scrapers...');
  const today = new Date().toISOString().split('T')[0];

  const insertShow = db.prepare(`
    INSERT OR IGNORE INTO shows (artist, date, time, venue, neighborhood, url, notes, status, source, type, genre, age, origin, staff_pick)
    VALUES (?, ?, 'TBA', ?, ?, ?, ?, 'live', 'scraped', ?, ?, 'All ages', 'TBA', ?)
  `);

  const insertAll = db.transaction((shows) => {
    let count = 0;
    for (const s of shows) {
      const date = parseDate(s.raw_date);
      if (!date || date < today) continue;
      const type = detectType((s.artist||'') + ' ' + (s.notes||''));
      const genre = detectGenre((s.artist||'') + ' ' + (s.notes||''));
      try {
        const result = insertShow.run(s.artist, date, s.venue, s.neighborhood, s.url, s.notes || '', s.staff_pick || 0, type, genre);
        if (result.changes > 0) count++;
      } catch (e) { /* duplicate, skip */ }
    }
    return count;
  });

  // Run all scrapers
  const allShows = [];

  // Dice venues
  for (const dv of DICE_VENUES) {
    const shows = await scrapeDice(dv);
    allShows.push(...shows);
  }

  // Direct venue scrapers
  const zebulonShows = await scrapeZebulon();
  allShows.push(...zebulonShows);

  const lodgeShows = await scrapeLodgeRoom();
  allShows.push(...lodgeShows);

  const roadhouseShows = await scrapePermanentRoadhouse();
  allShows.push(...roadhouseShows);

  await new Promise(r => setTimeout(r, 3000)); // wait 3s before hitting KCRW

  const kcrwShows = await scrapeKCRW();
  allShows.push(...kcrwShows);

  const added = insertAll(allShows);
  console.log(`Scrape complete. Added ${added} new shows from ${allShows.length} total found.`);
}

// Run scraper on startup and then nightly at 2am
runScraper();
cron.schedule('0 2 * * *', runScraper);

// ---- START ----
app.listen(PORT, () => {
  console.log(`LA Show Finder server running on http://localhost:${PORT}`);
});
