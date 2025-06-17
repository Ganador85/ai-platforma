
import axios from 'axios';

export async function searchSerpApi(query) {
  const apiKey = process.env.SERPAPI_KEY; // Įsitikink, kad .env faile yra SERPAPI_KEY=...
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&engine=google&hl=lt&gl=lt&api_key=${apiKey}`;

  try {
    const response = await axios.get(url);
    const results = response.data.organic_results;

    if (!results || results.length === 0) {
      return 'Nepavyko rasti rezultatų.';
    }

    // Sugeneruojam trumpą atsakymą iš pirmų kelių rezultatų
    const formatted = results.slice(0, 3).map(result => {
      return `🔹 *${result.title}*\n${result.snippet}\n${result.link}`;
    }).join('\n\n');

    return formatted;
  } catch (error) {
    console.error('Klaida vykdant SerpAPI paiešką:', error.message);
    return 'Įvyko klaida ieškant informacijos.';
  }
}
