// search.js
import fetch from 'node-fetch';
import cheerio from 'cheerio';

export async function searchDuckDuckGo(query) {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    try {
        const response = await fetch(searchUrl);
        const body = await response.text();
        const $ = cheerio.load(body);

        const results = [];
        $('.result__a').each((index, element) => {
            if (index < 5) {
                const title = $(element).text();
                const href = $(element).attr('href');
                results.push({ title, link: href });
            }
        });

        if (results.length === 0) {
            return 'Atsiprašau, pagal jūsų užklausą internete nieko konkretaus rasti nepavyko.';
        }

        return results.map((r, i) => `${i + 1}. [${r.title}](${r.link})`).join('\n');
    } catch (error) {
        console.error('DuckDuckGo paieškos klaida:', error);
        return 'Įvyko klaida atliekant paiešką.';
    }
}
