#!/usr/bin/env node
/**
 * Fetch Unsplash hero image URLs for city guides.
 * Loads UNSPLASH_ACCESS_KEY from .env.local if not in environment.
 * Usage: node scripts/get-unsplash-hero-urls.mjs
 *        node scripts/get-unsplash-hero-urls.mjs --hero-only   (only the 16 city-guide cities)
 *        node scripts/get-unsplash-hero-urls.mjs --hero-only --by-id  (fetch 5 fallback cities by photo ID; use if search hits rate limit)
 *        node scripts/get-unsplash-hero-urls.mjs --replace-hero  (only the 10 city-guide hero replacement slugs)
 *        node scripts/get-unsplash-hero-urls.mjs --fix-hero  (only the 11 city-guide hero fix slugs: wrong images)
 *        node scripts/get-unsplash-hero-urls.mjs --fix-guide-hero  (14 city guides: Trieste, Salamanca, Toledo, etc.)
 *        node scripts/get-unsplash-hero-urls.mjs --fix-guide-hero-2  (11 city guides: Yokohama, Arequipa, Salvador, etc.)
 *        node scripts/get-unsplash-hero-urls.mjs --fix-guide-hero-3  (12 city guides: Varna, Burgas, Constanța, Debrecen, Novi Sad, Ohrid, Astana, Chania, Corfu, Heraklion, Nafplio, Sarande)
 *        node scripts/get-unsplash-hero-urls.mjs --fix-guide-hero-4  (10 city guides: Malmö, Cagliari, Pamplona, Zaragoza, Lübeck, Hoi An, Luang Prabang, Yogyakarta, Lucca, Sorrento)
 *        node scripts/get-unsplash-hero-urls.mjs --fix-guide-hero-5  (14 city guides: Sheffield, Nottingham, Inverness, Stavanger, Tromsø, Aalborg, Essen, Ulaanbaatar, Windhoek, Lusaka, Maputo, Antananarivo, Sucre, Valparaíso)
 * If the API returns rate limit errors, wait and retry or paste vetted Unsplash photo URLs into city-itineraries.ts (same ?auto=format&fit=crop&w=1600&q=80 pattern).
 * If rate limit is hit, run again later or use --hero-only --by-id for oxford, santa-fe, asheville, savannah, graz.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
let KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!KEY) {
  try {
    const env = readFileSync(join(root, '.env.local'), 'utf8');
    const m = env.match(/^UNSPLASH_ACCESS_KEY=(.+)/m);
    if (m) KEY = m[1].trim();
  } catch (_) {}
}
if (!KEY) {
  console.error('UNSPLASH_ACCESS_KEY not found in env or .env.local');
  process.exit(1);
}

const QUERIES = [
  { slug: 'ghent', city: 'Ghent', query: 'Ghent Belgium Graslei canal medieval' },
  { slug: 'oxford', city: 'Oxford', query: 'Oxford university England Radcliffe Camera' },
  { slug: 'santa-fe', city: 'Santa Fe', query: 'Santa Fe New Mexico adobe' },
  { slug: 'charleston', city: 'Charleston', query: 'Charleston South Carolina Rainbow Row historic' },
  { slug: 'asheville', city: 'Asheville', query: 'Asheville North Carolina Blue Ridge' },
  { slug: 'memphis', city: 'Memphis', query: 'Memphis Tennessee Beale Street Mississippi' },
  { slug: 'savannah', city: 'Savannah', query: 'Savannah Georgia historic square' },
  { slug: 'york', city: 'York', query: 'York England Minster cathedral Shambles' },
  { slug: 'cambridge', city: 'Cambridge', query: 'Cambridge England King\'s College river Cam' },
  { slug: 'basel', city: 'Basel', query: 'Basel Switzerland Rhine Mittlere Brücke' },
  { slug: 'graz', city: 'Graz', query: 'Graz Austria city' },
  { slug: 'baltimore', city: 'Baltimore', query: 'Baltimore Inner Harbor skyline' },
  { slug: 'st-louis', city: 'St. Louis', query: 'St Louis Gateway Arch Missouri' },
  { slug: 'charlotte', city: 'Charlotte', query: 'Charlotte North Carolina skyline' },
  { slug: 'milwaukee', city: 'Milwaukee', query: 'Milwaukee Wisconsin lakefront Art Museum' },
  { slug: 'tucson', city: 'Tucson', query: 'Tucson Arizona desert saguaro mountains' },
  { slug: 'toulon', city: 'Toulon', query: 'Toulon France harbor Mediterranean' },
  { slug: 'birmingham', city: 'Birmingham', query: 'Birmingham England city' },
  { slug: 'dusseldorf', city: 'Düsseldorf', query: 'Düsseldorf Germany Rhine Rheinturm' },
  { slug: 'kuwait-city', city: 'Kuwait City', query: 'Kuwait Towers' },
  { slug: 'almaty', city: 'Almaty', query: 'Almaty Kazakhstan mountains city' },
  { slug: 'dar-es-salaam', city: 'Dar es Salaam', query: 'Dar es Salaam Tanzania waterfront' },
  { slug: 'stuttgart', city: 'Stuttgart', query: 'Stuttgart Germany city' },
  { slug: 'nuremberg', city: 'Nuremberg', query: 'Nuremberg Germany castle' },
  { slug: 'galway', city: 'Galway', query: 'Galway Ireland city' },
  { slug: 'cannes', city: 'Cannes', query: 'Cannes France beach' },
  { slug: 'catania', city: 'Catania', query: 'Catania Sicily city' },
  { slug: 'minneapolis', city: 'Minneapolis', query: 'Minneapolis Minnesota skyline' },
  { slug: 'santo-domingo', city: 'Santo Domingo', query: 'Santo Domingo colonial' },
  // Hero replacement set (use --replace-hero to run only these)
  { slug: 'vientiane', city: 'Vientiane', query: 'Vientiane Laos Pha That Luang Mekong' },
  { slug: 'yangon', city: 'Yangon', query: 'Yangon Myanmar Shwedagon Pagoda' },
  { slug: 'guatemala-city', city: 'Guatemala City', query: 'Guatemala City Guatemala skyline' },
  { slug: 'san-jose-costa-rica', city: 'San José', query: 'San Jose Costa Rica National Theatre city' },
  { slug: 'addis-ababa', city: 'Addis Ababa', query: 'Addis Ababa Ethiopia city' },
  { slug: 'reims', city: 'Reims', query: 'Reims Cathedral France champagne' },
  { slug: 'bremen', city: 'Bremen', query: 'Bremen Germany Markt Roland' },
  { slug: 'hanover', city: 'Hanover', query: 'Hanover Germany Herrenhausen Gardens' },
  { slug: 'limerick', city: 'Limerick', query: 'Limerick Ireland King John Castle Shannon' },
  { slug: 'ostrava', city: 'Ostrava', query: 'Ostrava Czech Republic' },
  { slug: 'las-palmas', city: 'Las Palmas', query: 'Las Palmas Gran Canaria Las Canteras beach' },
  { slug: 'coimbra', city: 'Coimbra', query: 'Coimbra Portugal university city' },
  { slug: 'cadiz', city: 'Cádiz', query: 'Cadiz Spain old town' },
  { slug: 'gijon', city: 'Gijón', query: 'Gijon Spain Asturias beach' },
  { slug: 'oviedo', city: 'Oviedo', query: 'Oviedo Spain cathedral Asturias' },
  { slug: 'aarhus', city: 'Aarhus', query: 'Aarhus Denmark ARoS rainbow panorama' },
  { slug: 'penang', city: 'Penang', query: 'Penang Malaysia George Town shophouses' },
  { slug: 'salt-lake-city', city: 'Salt Lake City', query: 'Salt Lake City Utah mountains' },
  { slug: 'la-paz', city: 'La Paz', query: 'La Paz Bolivia cable car cityscape' },
  { slug: 'trondheim', city: 'Trondheim', query: 'Trondheim Norway Nidaros Cathedral Bakklandet' },
];

// Hero fix set: city guides with non–city-related hero images (use --fix-hero to run only these)
const HERO_FIX_SLUGS = [
  'canberra', 'christchurch', 'heidelberg', 'poznan', 'halifax', 'siena',
  'annecy', 'monaco', 'utrecht', 'santiago-de-compostela',
  'andorra-la-vella', 'vaduz', 'san-marino', 'phnom-penh', 'chengdu',
  'leeds', 'newcastle', 'brighton', 'rabat', 'tangier',
];
const FIX_HERO_QUERIES = [
  { slug: 'canberra', city: 'Canberra', query: 'Canberra Australia Parliament House Lake Burley Griffin' },
  { slug: 'christchurch', city: 'Christchurch', query: 'Christchurch New Zealand Botanic Gardens Avon' },
  { slug: 'heidelberg', city: 'Heidelberg', query: 'Heidelberg Germany castle old town Neckar' },
  { slug: 'poznan', city: 'Poznan', query: 'Poznan Poland' },
  { slug: 'halifax', city: 'Halifax', query: 'Halifax Nova Scotia Canada' },
  { slug: 'siena', city: 'Siena', query: 'Siena Italy Piazza del Campo Tuscany' },
  { slug: 'annecy', city: 'Annecy', query: 'Annecy France lake Lac' },
  { slug: 'monaco', city: 'Monaco', query: 'Monaco Monte Carlo harbor Mediterranean' },
  { slug: 'utrecht', city: 'Utrecht', query: 'Utrecht Netherlands Dom Tower canals' },
  { slug: 'santiago-de-compostela', city: 'Santiago de Compostela', query: 'Santiago de Compostela cathedral Spain Camino' },
  { slug: 'andorra-la-vella', city: 'Andorra la Vella', query: 'Andorra Pyrenees mountains valley' },
  { slug: 'vaduz', city: 'Vaduz', query: 'Vaduz Liechtenstein castle Alps' },
  { slug: 'san-marino', city: 'San Marino', query: 'San Marino Three Towers Mount Titano Italy' },
  { slug: 'phnom-penh', city: 'Phnom Penh', query: 'Phnom Penh Cambodia Royal Palace riverside' },
  { slug: 'chengdu', city: 'Chengdu', query: 'Chengdu China city skyline' },
  { slug: 'leeds', city: 'Leeds', query: 'Leeds England UK city center' },
  { slug: 'newcastle', city: 'Newcastle', query: 'Newcastle upon Tyne Tyne Bridge England' },
  { slug: 'brighton', city: 'Brighton', query: 'Brighton UK Palace Pier beach' },
  { slug: 'rabat', city: 'Rabat', query: 'Rabat Morocco city' },
  { slug: 'tangier', city: 'Tangier', query: 'Tangier Morocco city' },
];

// 14 city guides with broken or non–city-related hero images (use --fix-guide-hero to run only these)
const GUIDE_HERO_FIX_QUERIES = [
  { slug: 'trieste', city: 'Trieste', query: 'Trieste Italy Piazza Unità Adriatic Miramare' },
  { slug: 'salamanca', city: 'Salamanca', query: 'Salamanca Spain Plaza Mayor university golden stone' },
  { slug: 'toledo', city: 'Toledo', query: 'Toledo Spain skyline cathedral Alcázar' },
  { slug: 'avignon', city: 'Avignon', query: 'Avignon France Palace of the Popes Pont Saint-Bénézet' },
  { slug: 'montpellier', city: 'Montpellier', query: 'Montpellier France Place de la Comédie' },
  { slug: 'regensburg', city: 'Regensburg', query: 'Regensburg Germany Stone Bridge Danube old town' },
  { slug: 'freiburg', city: 'Freiburg', query: 'Freiburg Germany Minster Münsterplatz' },
  { slug: 'bergamo', city: 'Bergamo', query: 'Bergamo Italy Città Alta Venetian walls' },
  { slug: 'padua', city: 'Padua', query: 'Padua Italy Prato della Valle' },
  { slug: 'modena', city: 'Modena', query: 'Modena Italy cathedral Ghirlandina Piazza Grande' },
  { slug: 'ravenna', city: 'Ravenna', query: 'Ravenna Italy mosaics San Vitale' },
  { slug: 'colmar', city: 'Colmar', query: 'Colmar France half-timbered Little Venice Alsace' },
  { slug: 'metz', city: 'Metz', query: 'Metz France cathedral Centre Pompidou' },
  { slug: 'perugia', city: 'Perugia', query: 'Perugia Italy Piazza IV Novembre Umbria' },
];

// 11 city guides with broken or non–city-related hero images (use --fix-guide-hero-2 to run only these)
const GUIDE_HERO_FIX_2_QUERIES = [
  { slug: 'yokohama', city: 'Yokohama', query: 'Yokohama Japan harbor Minato Mirai' },
  { slug: 'arequipa', city: 'Arequipa', query: 'Arequipa Peru White City Misti volcano' },
  { slug: 'salvador', city: 'Salvador', query: 'Salvador Brazil Pelourinho colonial' },
  { slug: 'incheon', city: 'Incheon', query: 'Incheon South Korea Chinatown waterfront' },
  { slug: 'plovdiv', city: 'Plovdiv', query: 'Plovdiv Bulgaria Old Town Roman theatre' },
  { slug: 'brno', city: 'Brno', query: 'Brno Czech Republic Spilberk old town' },
  { slug: 'kaunas', city: 'Kaunas', query: 'Kaunas Lithuania old town Nemunas' },
  { slug: 'cluj-napoca', city: 'Cluj-Napoca', query: 'Cluj-Napoca Romania Union Square' },
  { slug: 'timisoara', city: 'Timișoara', query: 'Timisoara Romania Opera Square' },
  { slug: 'sibiu', city: 'Sibiu', query: 'Sibiu Romania Large Square Bridge of Lies' },
  { slug: 'zadar', city: 'Zadar', query: 'Zadar Croatia Sea Organ sunset waterfront' },
];

// 12 city guides with broken or non–city-related hero images (use --fix-guide-hero-3 to run only these)
const GUIDE_HERO_FIX_3_QUERIES = [
  { slug: 'varna', city: 'Varna', query: 'Black Sea Bulgaria coast' },
  { slug: 'burgas', city: 'Burgas', query: 'Bulgaria Black Sea coast beach' },
  { slug: 'constanta', city: 'Constanța', query: 'Romania Black Sea Constanta' },
  { slug: 'debrecen', city: 'Debrecen', query: 'Debrecen Hungary Great Church' },
  { slug: 'novi-sad', city: 'Novi Sad', query: 'Novi Sad Serbia Petrovaradin Fortress Danube' },
  { slug: 'ohrid', city: 'Ohrid', query: 'Ohrid North Macedonia Lake St John church' },
  { slug: 'astana', city: 'Astana', query: 'Astana Kazakhstan Bayterek Tower' },
  { slug: 'chania', city: 'Chania', query: 'Chania Crete Greece harbor old town' },
  { slug: 'corfu', city: 'Corfu', query: 'Corfu Greece old town fortress' },
  { slug: 'heraklion', city: 'Heraklion', query: 'Heraklion Crete Greece harbor' },
  { slug: 'nafplio', city: 'Nafplio', query: 'Nafplio Greece fortress Peloponnese' },
  { slug: 'sarande', city: 'Sarande', query: 'Albania coast beach Mediterranean' },
];

// 10 city guides with broken or non–city-related hero images (use --fix-guide-hero-4 to run only these)
const GUIDE_HERO_FIX_4_QUERIES = [
  { slug: 'malmo', city: 'Malmö', query: 'Malmö Sweden Turning Torso waterfront' },
  { slug: 'cagliari', city: 'Cagliari', query: 'Cagliari Italy Sardinia coast' },
  { slug: 'pamplona', city: 'Pamplona', query: 'Pamplona Spain city Navarre' },
  { slug: 'zaragoza', city: 'Zaragoza', query: 'Zaragoza Spain Basilica del Pilar Ebro' },
  { slug: 'lubeck', city: 'Lübeck', query: 'Lubeck Germany old town brick' },
  { slug: 'hoi-an', city: 'Hoi An', query: 'Hoi An Vietnam old town lanterns river' },
  { slug: 'luang-prabang', city: 'Luang Prabang', query: 'Luang Prabang Laos Mekong temple' },
  { slug: 'yogyakarta', city: 'Yogyakarta', query: 'Yogyakarta Indonesia Borobudur' },
  { slug: 'lucca', city: 'Lucca', query: 'Lucca Italy walls Tuscany' },
  { slug: 'sorrento', city: 'Sorrento', query: 'Sorrento Italy Amalfi coast cliffs' },
];

// 14 city guides: hero images (use --fix-guide-hero-5 to run only these)
const GUIDE_HERO_FIX_5_QUERIES = [
  { slug: 'sheffield', city: 'Sheffield', query: 'Sheffield England Winter Garden Peace Gardens UK' },
  { slug: 'nottingham', city: 'Nottingham', query: 'Nottingham England castle Old Market Square UK' },
  { slug: 'inverness', city: 'Inverness', query: 'Inverness Scotland River Ness castle UK' },
  { slug: 'stavanger', city: 'Stavanger', query: 'Stavanger Norway Gamle Stavanger harbor wooden houses' },
  { slug: 'tromso', city: 'Tromsø', query: 'Tromso Norway Arctic Cathedral bridge' },
  { slug: 'aalborg', city: 'Aalborg', query: 'Aalborg Denmark Limfjord waterfront city' },
  { slug: 'essen', city: 'Essen', query: 'Essen Germany Zollverein coal mine UNESCO industrial' },
  { slug: 'ulaanbaatar', city: 'Ulaanbaatar', query: 'Ulaanbaatar Mongolia Gandan monastery city hills' },
  { slug: 'windhoek', city: 'Windhoek', query: 'Windhoek Namibia Christuskirche Independence Avenue' },
  { slug: 'lusaka', city: 'Lusaka', query: 'Lusaka Zambia city skyline Africa' },
  { slug: 'maputo', city: 'Maputo', query: 'Maputo Mozambique waterfront Indian Ocean coast' },
  { slug: 'antananarivo', city: 'Antananarivo', query: 'Antananarivo Madagascar hillside city Rova' },
  { slug: 'sucre', city: 'Sucre', query: 'Sucre Bolivia white city colonial plaza UNESCO' },
  { slug: 'valparaiso', city: 'Valparaíso', query: 'Valparaiso Chile colorful houses hills funicular bay' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = 'https://api.unsplash.com/search/photos';
const photoBase = 'https://api.unsplash.com/photos';
const HERO_ONLY = process.argv.includes('--hero-only');
const BY_ID = process.argv.includes('--by-id');
const REPLACE_HERO = process.argv.includes('--replace-hero');
const FIX_HERO = process.argv.includes('--fix-hero');
const FIX_GUIDE_HERO = process.argv.includes('--fix-guide-hero');
const FIX_GUIDE_HERO_2 = process.argv.includes('--fix-guide-hero-2');
const FIX_GUIDE_HERO_3 = process.argv.includes('--fix-guide-hero-3');
const FIX_GUIDE_HERO_4 = process.argv.includes('--fix-guide-hero-4');
const FIX_GUIDE_HERO_5 = process.argv.includes('--fix-guide-hero-5');
const NEW_GUIDE_SLUGS = ['sheffield', 'nottingham', 'inverness', 'stavanger', 'tromso', 'aalborg', 'essen'];
const NEW_GUIDES = process.argv.includes('--new-guides');
const HERO_REPLACEMENT_SLUGS = [
  'ostrava', 'las-palmas', 'coimbra', 'cadiz', 'gijon', 'oviedo',
  'aarhus', 'penang', 'salt-lake-city', 'la-paz', 'trondheim',
];
// Known Unsplash photo IDs for cities that often get NO_RESULT from search (e.g. due to rate limit)
const PHOTO_IDS = {
  oxford: '73Y466xwLJM',
  'santa-fe': 'LCYgF2kcxTA',
  asheville: '60IeQ4lmDGs',
  savannah: 'r2Uz3Rbs6hE',
  graz: '4vSb71TnB5A',
};
// Fallback by-ID for --fix-guide-hero-4 when search hits rate limit (Lübeck, Luang Prabang)
const PHOTO_IDS_GUIDE_HERO_4 = {
  lubeck: 'vPWn7zprVH4',
  'luang-prabang': 'fFL5K3A3uGo',
};
const queriesToRun = NEW_GUIDES
  ? QUERIES.filter((q) => NEW_GUIDE_SLUGS.includes(q.slug))
  : FIX_GUIDE_HERO_5
  ? GUIDE_HERO_FIX_5_QUERIES
  : FIX_GUIDE_HERO_4
  ? GUIDE_HERO_FIX_4_QUERIES
  : FIX_GUIDE_HERO_3
  ? GUIDE_HERO_FIX_3_QUERIES
  : FIX_GUIDE_HERO_2
  ? GUIDE_HERO_FIX_2_QUERIES
  : FIX_GUIDE_HERO
  ? GUIDE_HERO_FIX_QUERIES
  : FIX_HERO
  ? FIX_HERO_QUERIES
  : REPLACE_HERO
    ? QUERIES.filter((q) => HERO_REPLACEMENT_SLUGS.includes(q.slug))
    : HERO_ONLY
      ? QUERIES.filter((q) => ['oxford', 'santa-fe', 'asheville', 'savannah', 'graz'].includes(q.slug))
      : QUERIES;

if (BY_ID && HERO_ONLY) {
  for (const slug of Object.keys(PHOTO_IDS)) {
    try {
      await sleep(500);
      const res = await fetch(`${photoBase}/${PHOTO_IDS[slug]}`, {
        headers: { Authorization: `Client-ID ${KEY}` },
      });
      const data = await res.json();
      const regular = data?.urls?.regular;
      if (regular) {
        const heroUrl = regular.replace(/\?.*$/, '') + '?auto=format&fit=crop&w=1600&q=80';
        console.log(slug + '|' + heroUrl);
      } else {
        console.error(slug + '|NO_RESULT');
      }
    } catch (e) {
      console.error(slug + '|ERROR ' + e.message);
    }
  }
} else {
  for (const { slug, city, query } of queriesToRun) {
    try {
      await sleep(400);
      let regular;
      if (
        queriesToRun === GUIDE_HERO_FIX_4_QUERIES &&
        PHOTO_IDS_GUIDE_HERO_4[slug]
      ) {
        const idRes = await fetch(`${photoBase}/${PHOTO_IDS_GUIDE_HERO_4[slug]}`, {
          headers: { Authorization: `Client-ID ${KEY}` },
        });
        const idData = await idRes.json();
        regular = idData?.urls?.regular;
      } else {
        const url = `${base}?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
        const res = await fetch(url, { headers: { Authorization: `Client-ID ${KEY}` } });
        const data = await res.json();
        regular = data?.results?.[0]?.urls?.regular;
      }
      if (regular) {
        const heroUrl = regular.replace(/\?.*$/, '') + '?auto=format&fit=crop&w=1600&q=80';
        console.log(slug + '|' + heroUrl);
      } else {
        console.error(slug + '|NO_RESULT');
      }
    } catch (e) {
      console.error(slug + '|ERROR ' + e.message);
    }
  }
}
