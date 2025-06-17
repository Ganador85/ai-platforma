
const fetch = require('node-fetch');
const cheerio = require('cheerio');

/**
 * Atliekama paieška DuckDuckGo per HTML scraping.
 * @param {string} query - Paieškos užklausa.
 * @returns {Promise<string>} - Pirmi 3 rezultatai kaip tekstas.
 */
async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    const body = await response.text();
    const $ = cheerio.load(body);

    const results = [];
    $('.result__snippet').each((i, el) => {
      if (i < 3) {
        results.push($(el).text().trim());
      }
    });

    return results.length > 0
      ? results.join('\n\n')
      : 'Nerasta jokių rezultatų.';
  } catch (error) {
    console.error('Klaida atliekant paiešką:', error);
    return 'Įvyko klaida atliekant paiešką.';
  }
}

module.exports = { searchDuckDuckGo };
