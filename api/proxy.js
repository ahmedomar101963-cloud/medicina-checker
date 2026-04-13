import { readFileSync } from 'fs';
import { join } from 'path';

let haadCache = null;

function loadHAAD() {
  if (haadCache) return haadCache;
  try {
    const filePath = join(process.cwd(), 'public', 'haad_data.json');
    const data = readFileSync(filePath, 'utf8');
    haadCache = JSON.parse(data);
    return haadCache;
  } catch (e) {
    return null;
  }
}

function searchDrugs(haad, genericName, insType) {
  if (!haad) return { covered: [], notCovered: [] };
  const query = genericName.toLowerCase().trim();
  const words = query.split(/[\s,+\/]+/).filter(w => w.length > 3);
  const insMap = { thiqa: 't', basic: 'b', abm1: 'a1', abm7: 'a7' };
  const insKey = insMap[insType] || 't';

  let matches = haad.filter(d => {
    const g = d.g;
    if (words.length === 0) return g.includes(query);
    return words.every(w => g.includes(w));
  });

  if (matches.length === 0) {
    matches = haad.filter(d => {
      const g = d.g;
      return words.some(w => w.length > 4 && g.includes(w));
    });
  }

  const covered = matches.filter(d => d[insKey] === 1).map(d => ({ package_name: d.p, strength: d.s, form: d.f }));
  const notCovered = matches.filter(d => d[insKey] === 0).map(d => ({ package_name: d.p, strength: d.s, form: d.f }));
  return { covered: covered.slice(0, 15), notCovered: notCovered.slice(0, 8) };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version, x-action');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const action = req.headers['x-action'];

    if (action === 'search-haad') {
      const { drugs, insurance } = req.body;
      const haad = loadHAAD();
      if (!haad) return res.status(500).json({ error: 'HAAD data not available' });

      const results = drugs.map(drug => {
        const found = searchDrugs(haad, drug.generic_name, insurance);
        return {
          generic_name: drug.generic_name,
          brand_written: drug.brand_written,
          covered: found.covered.length > 0,
          covered_options: found.covered,
          uncovered_options: found.notCovered,
          not_found: (found.covered.length + found.notCovered.length) === 0
        };
      });

      return res.status(200).json({ results });
    }

    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.ok ? 200 : response.status).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
