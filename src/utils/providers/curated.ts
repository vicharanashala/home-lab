/**
 * Curated chain HQ list. Always available (no network, no key). City-center
 * coordinates are an approximation — actual branches may be elsewhere in the
 * city. Downstream UI labels these entries as "HQ" so users aren't misled.
 */

import type { Provider, ProviderResult, RawStore, SearchParams } from './types';
import { haversineM } from './dedup';

const ENTRIES: Array<{ name: string; city: string; lat: number; lon: number }> = [
  // Punjab / Haryana / Chandigarh region — user's primary area
  { name: 'Reliance Smart', city: 'Rupnagar', lat: 30.9667, lon: 76.5333 },
  { name: 'JioMart', city: 'Rupnagar', lat: 30.9667, lon: 76.5333 },
  { name: 'Easyday', city: 'Rupnagar', lat: 30.9667, lon: 76.5333 },
  { name: 'Big Bazaar', city: 'Rupnagar', lat: 30.9667, lon: 76.5333 },
  { name: 'More', city: 'Rupnagar', lat: 30.9667, lon: 76.5333 },

  { name: 'Reliance Fresh', city: 'Chandigarh', lat: 30.7333, lon: 76.7794 },
  { name: 'Big Bazaar', city: 'Chandigarh', lat: 30.7333, lon: 76.7794 },
  { name: 'D-Mart', city: 'Chandigarh', lat: 30.7333, lon: 76.7794 },
  { name: 'JioMart', city: 'Chandigarh', lat: 30.7333, lon: 76.7794 },
  { name: 'Spencer’s', city: 'Chandigarh', lat: 30.7333, lon: 76.7794 },
  { name: 'More', city: 'Chandigarh', lat: 30.7333, lon: 76.7794 },
  { name: 'Easyday', city: 'Chandigarh', lat: 30.7333, lon: 76.7794 },

  { name: 'Reliance Fresh', city: 'Mohali', lat: 30.7046, lon: 76.7179 },
  { name: 'Big Bazaar', city: 'Mohali', lat: 30.7046, lon: 76.7179 },
  { name: 'D-Mart', city: 'Mohali', lat: 30.7046, lon: 76.7179 },
  { name: 'Reliance Fresh', city: 'Panchkula', lat: 30.6942, lon: 76.8606 },
  { name: 'Big Bazaar', city: 'Panchkula', lat: 30.6942, lon: 76.8606 },

  { name: 'Easyday', city: 'Kharar', lat: 30.7483, lon: 76.6476 },
  { name: 'Reliance Fresh', city: 'Kharar', lat: 30.7483, lon: 76.6476 },
  { name: 'JioMart', city: 'Kharar', lat: 30.7483, lon: 76.6476 },

  { name: 'Reliance Fresh', city: 'Ludhiana', lat: 30.901, lon: 75.8573 },
  { name: 'Big Bazaar', city: 'Ludhiana', lat: 30.901, lon: 75.8573 },
  { name: 'D-Mart', city: 'Ludhiana', lat: 30.901, lon: 75.8573 },
  { name: 'JioMart', city: 'Ludhiana', lat: 30.901, lon: 75.8573 },
  { name: 'Easyday', city: 'Ludhiana', lat: 30.901, lon: 75.8573 },
  { name: 'More', city: 'Ludhiana', lat: 30.901, lon: 75.8573 },

  { name: 'Reliance Fresh', city: 'Amritsar', lat: 31.634, lon: 74.8723 },
  { name: 'Big Bazaar', city: 'Amritsar', lat: 31.634, lon: 74.8723 },
  { name: 'D-Mart', city: 'Amritsar', lat: 31.634, lon: 74.8723 },
  { name: 'JioMart', city: 'Amritsar', lat: 31.634, lon: 74.8723 },

  { name: 'Reliance Fresh', city: 'Jalandhar', lat: 31.326, lon: 75.5792 },
  { name: 'Big Bazaar', city: 'Jalandhar', lat: 31.326, lon: 75.5792 },
  { name: 'D-Mart', city: 'Jalandhar', lat: 31.326, lon: 75.5792 },
  { name: 'JioMart', city: 'Jalandhar', lat: 31.326, lon: 75.5792 },

  { name: 'Reliance Fresh', city: 'Patiala', lat: 30.3398, lon: 76.3869 },
  { name: 'Big Bazaar', city: 'Patiala', lat: 30.3398, lon: 76.3869 },
  { name: 'D-Mart', city: 'Patiala', lat: 30.3398, lon: 76.3869 },
  { name: 'JioMart', city: 'Patiala', lat: 30.3398, lon: 76.3869 },

  { name: 'Big Bazaar', city: 'Ambala', lat: 30.3782, lon: 76.7767 },
  { name: 'Reliance Fresh', city: 'Ambala', lat: 30.3782, lon: 76.7767 },
  { name: 'JioMart', city: 'Ambala', lat: 30.3782, lon: 76.7767 },

  // Delhi NCR
  { name: 'Reliance Fresh', city: 'Delhi', lat: 28.6139, lon: 77.2090 },
  { name: 'Big Bazaar', city: 'Delhi', lat: 28.6139, lon: 77.2090 },
  { name: 'D-Mart', city: 'Delhi', lat: 28.6139, lon: 77.2090 },
  { name: 'Spencer’s', city: 'Delhi', lat: 28.6139, lon: 77.2090 },
  { name: 'JioMart', city: 'Delhi', lat: 28.6139, lon: 77.2090 },
  { name: 'Easyday', city: 'Delhi', lat: 28.6139, lon: 77.2090 },
  { name: 'Reliance Fresh', city: 'Gurgaon', lat: 28.4595, lon: 77.0266 },
  { name: 'Big Bazaar', city: 'Gurgaon', lat: 28.4595, lon: 77.0266 },
  { name: 'D-Mart', city: 'Gurgaon', lat: 28.4595, lon: 77.0266 },
  { name: 'Reliance Fresh', city: 'Noida', lat: 28.5355, lon: 77.3910 },
  { name: 'Big Bazaar', city: 'Noida', lat: 28.5355, lon: 77.3910 },
  { name: 'D-Mart', city: 'Ghaziabad', lat: 28.6692, lon: 77.4538 },

  // Mumbai / Pune
  { name: 'Reliance Fresh', city: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'Big Bazaar', city: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'D-Mart', city: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'Spencer’s', city: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'Nature’s Basket', city: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'JioMart', city: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'Reliance Fresh', city: 'Navi Mumbai', lat: 19.033, lon: 73.0297 },
  { name: 'D-Mart', city: 'Thane', lat: 19.2183, lon: 72.9781 },
  { name: 'Reliance Fresh', city: 'Pune', lat: 18.5204, lon: 73.8567 },
  { name: 'Big Bazaar', city: 'Pune', lat: 18.5204, lon: 73.8567 },
  { name: 'D-Mart', city: 'Pune', lat: 18.5204, lon: 73.8567 },
  { name: 'JioMart', city: 'Pune', lat: 18.5204, lon: 73.8567 },

  // Bangalore / Hyderabad / Chennai / Kolkata
  { name: 'Reliance Fresh', city: 'Bangalore', lat: 12.9716, lon: 77.5946 },
  { name: 'Big Bazaar', city: 'Bangalore', lat: 12.9716, lon: 77.5946 },
  { name: 'D-Mart', city: 'Bangalore', lat: 12.9716, lon: 77.5946 },
  { name: 'More', city: 'Bangalore', lat: 12.9716, lon: 77.5946 },
  { name: 'Star Bazaar', city: 'Bangalore', lat: 12.9716, lon: 77.5946 },
  { name: 'Nilgiris', city: 'Bangalore', lat: 12.9716, lon: 77.5946 },
  { name: 'JioMart', city: 'Bangalore', lat: 12.9716, lon: 77.5946 },
  { name: 'Reliance Fresh', city: 'Hyderabad', lat: 17.385, lon: 78.4867 },
  { name: 'Big Bazaar', city: 'Hyderabad', lat: 17.385, lon: 78.4867 },
  { name: 'D-Mart', city: 'Hyderabad', lat: 17.385, lon: 78.4867 },
  { name: 'Heritage', city: 'Hyderabad', lat: 17.385, lon: 78.4867 },
  { name: 'JioMart', city: 'Hyderabad', lat: 17.385, lon: 78.4867 },
  { name: 'Reliance Fresh', city: 'Chennai', lat: 13.0827, lon: 80.2707 },
  { name: 'Spencer’s', city: 'Chennai', lat: 13.0827, lon: 80.2707 },
  { name: 'Big Bazaar', city: 'Chennai', lat: 13.0827, lon: 80.2707 },
  { name: 'D-Mart', city: 'Chennai', lat: 13.0827, lon: 80.2707 },
  { name: 'JioMart', city: 'Chennai', lat: 13.0827, lon: 80.2707 },
  { name: 'Reliance Fresh', city: 'Kolkata', lat: 22.5726, lon: 88.3639 },
  { name: 'Big Bazaar', city: 'Kolkata', lat: 22.5726, lon: 88.3639 },
  { name: 'D-Mart', city: 'Kolkata', lat: 22.5726, lon: 88.3639 },
  { name: 'JioMart', city: 'Kolkata', lat: 22.5726, lon: 88.3639 },

  // Other metros
  { name: 'Reliance Fresh', city: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
  { name: 'D-Mart', city: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
  { name: 'Big Bazaar', city: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
  { name: 'Star Bazaar', city: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
  { name: 'JioMart', city: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
  { name: 'Reliance Fresh', city: 'Jaipur', lat: 26.9124, lon: 75.7873 },
  { name: 'Big Bazaar', city: 'Jaipur', lat: 26.9124, lon: 75.7873 },
  { name: 'JioMart', city: 'Jaipur', lat: 26.9124, lon: 75.7873 },
  { name: 'Big Bazaar', city: 'Indore', lat: 22.7196, lon: 75.8577 },
  { name: 'Big Bazaar', city: 'Bhopal', lat: 23.2599, lon: 77.4126 },
  { name: 'Big Bazaar', city: 'Nagpur', lat: 21.1458, lon: 79.0882 },
  { name: 'Reliance Fresh', city: 'Coimbatore', lat: 11.0168, lon: 76.9558 },
  { name: 'Big Bazaar', city: 'Coimbatore', lat: 11.0168, lon: 76.9558 },
  { name: 'Reliance Fresh', city: 'Kochi', lat: 9.9312, lon: 76.2673 },
  { name: 'Big Bazaar', city: 'Kochi', lat: 9.9312, lon: 76.2673 },
  { name: 'Big Bazaar', city: 'Lucknow', lat: 26.8467, lon: 80.9462 },
  { name: 'Big Bazaar', city: 'Dehradun', lat: 30.3165, lon: 78.0322 },
  { name: 'Big Bazaar', city: 'Patna', lat: 25.5941, lon: 85.1376 },
  { name: 'Big Bazaar', city: 'Guwahati', lat: 26.1445, lon: 91.7362 },
];

export const curatedProvider: Provider = {
  name: 'curated',
  isConfigured: () => true,
  attribution: {
    label: 'Curated chain HQ references',
    url: 'https://github.com/yourname/homehub',
  },
  termsNote: 'Built-in reference list — not a real-time source.',
  search: async (p: SearchParams): Promise<ProviderResult> => {
    const t0 = performance.now();
    const out: RawStore[] = [];
    const seen = new Set<string>();
    for (const e of ENTRIES) {
      const key = `${e.name.toLowerCase()}|${e.city.toLowerCase()}`;
      if (seen.has(key)) continue;
      const dist = haversineM(p.lat, p.lon, e.lat, e.lon);
      if (dist > p.radiusM) continue;
      seen.add(key);
      out.push({
        source: 'curated',
        providerPlaceId: `curated:${e.name}/${e.city}`,
        name: e.name,
        lat: e.lat,
        lon: e.lon,
        city: e.city,
        type: 'chain',
        categories: ['chain_hq'],
      });
    }
    out.sort((a, b) => {
      const da = haversineM(p.lat, p.lon, a.lat, a.lon);
      const db = haversineM(p.lat, p.lon, b.lat, b.lon);
      return da - db;
    });
    return {
      source: 'curated', ok: true, stores: out.slice(0, p.limit), configured: true,
      ms: performance.now() - t0,
    };
  },
};