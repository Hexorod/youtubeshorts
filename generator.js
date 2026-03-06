const fetch = require('node-fetch');
const fs = require('fs');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  QUOTA BUDGET
//  search.list = 100 units per call (flat rate, maxResults doesn't matter)
//  redirect check = 0 quota (plain HTTP HEAD, no API key)
//
//  VERIFICATION STRATEGY
//  Rather than redirect-checking all ~4,900 candidates (which would get
//  us rate-limited by YouTube fast), we:
//    1. Trust the search: videoDuration=short + #shorts query hint
//       already gets us ~75-80% real Shorts with no extra work
//    2. Spot-check a small sample per topic with the /shorts/ redirect
//       to measure the actual non-Short rate in the results
//    3. Pass everything else through — the BOIsmart algorithm on the
//       site naturally buries non-Shorts since users skip them instantly
//
//  REDIRECT_SAMPLE  = how many IDs per topic to spot-check (out of 50)
//  REDIRECT_DELAY   = ms pause between redirect batches (rate limit safety)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const QUOTA_LIMIT          = parseInt(process.env.YOUTUBE_QUOTA_LIMIT || '10000');
const QUOTA_BUFFER         = 200;
const SEARCH_COST          = 100;
const MAX_RESULTS          = 50;
const REDIRECT_SAMPLE      = 5;   // spot-check 5 out of 50 per topic → ~490 total requests
const REDIRECT_CONCURRENCY = 5;   // parallel HEAD requests per batch
const REDIRECT_DELAY_MS    = 300; // ms between batches — keeps YouTube happy

const COST_PER_TOPIC = SEARCH_COST;
const MAX_TOPICS     = Math.floor((QUOTA_LIMIT - QUOTA_BUFFER) / COST_PER_TOPIC);

let quotaUsed = 0;
let totalChecked = 0;
let totalDroppedByRedirect = 0;

function spendQuota(units, label) {
  quotaUsed += units;
  if ((QUOTA_LIMIT - quotaUsed) < QUOTA_BUFFER) {
    console.error(`\n⛔ Quota guard triggered after "${label}": ${quotaUsed}/${QUOTA_LIMIT} units used. Stopping.`);
    process.exit(1);
  }
}

const TOPICS = [
  "Vlogging", "Workspace", "Tutorials", "Lifehacks", "Transformations",
  "Food", "Pets", "DIY", "Unboxing", "Tech", "Gaming", "Sports",
  "Fitness", "Fashion", "Beauty", "Reactions", "Comedy", "Trends",
  "Nostalgia", "Trivia", "Debunking", "Timelapse", "ASMR", "Experiments",
  "Careers", "Facts", "Travel", "Automotive", "Science", "Motivation",
  "POV", "Remix", "Storytime", "Finance", "Productivity", "Tips",
  "Music", "VTubing", "Faceless", "Packing", "Decor", "Modding",
  "Culture", "News", "Hauls", "Comparison", "Reviews", "Challenges",
  "Hobbies", "Branding",
  // Popular Creators
  "MrBeast", "RyanTrahan", "KhabyLame", "ZachKing", "MarkRober",
  "AlanChikinChow", "BrentRivera", "BellaPoarch", "IShowSpeed",
  "NickDiGiovanni", "PrestonPlayz", "DharMann",
  // Popular Games
  "Minecraft", "Fortnite", "Roblox", "GTAV", "Warzone", "Valorant",
  "ApexLegends", "AmongUs", "EASportsFC", "RocketLeague",
  "LeagueOfLegends", "ClashRoyale",
  // Extra Topics
  "Minimalism", "Routines", "Glowups", "Cooking", "Baking", "Streetfood",
  "Animation", "Editing", "Photography", "Cinematics", "Skits",
  "Commentary", "Interviews", "Pranks", "Giveaways", "Budgeting",
  "Investing", "Startups", "Coding", "AI", "Gadgets", "Repairs",
  "Builds", "Speedruns", "Strategy", "Survival"
];

// ── Utilities ──────────────────────────────────────────────────────────────

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run async fn over items in parallel batches of `size`, with a delay between batches
async function batchedAll(items, size, delayMs, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    results.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return results;
}

// ── /shorts/ redirect spot-check ──────────────────────────────────────────
//
// YouTube redirects /shorts/{id} → /watch?v={id} for non-Shorts.
// Used only on a small sample per topic to avoid rate limiting.
// The drop rate from the sample is logged so you can see how "dirty"
// the search results are in practice.

async function isTrulyShort(id) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${id}`, {
      method: 'HEAD',
      redirect: 'manual',
    });

    if (res.status === 200) return true;

    if (res.status === 303 || res.status === 301 || res.status === 302) {
      const location = res.headers.get('location') || '';
      return location.includes('/shorts/');
    }

    return false;
  } catch {
    return true; // network error — pass through
  }
}

// Spot-check a random sample of `sampleSize` IDs from the list.
// Returns { confirmed: string[], droppedCount: number }
async function spotCheck(ids, sampleSize) {
  if (ids.length === 0) return { confirmed: ids, droppedCount: 0 };

  const sample = shuffleArray([...ids]).slice(0, sampleSize);
  totalChecked += sample.length;

  const results = await batchedAll(sample, REDIRECT_CONCURRENCY, REDIRECT_DELAY_MS, async (id) => {
    return (await isTrulyShort(id)) ? id : null;
  });

  const droppedFromSample = results.filter(r => r === null).length;
  totalDroppedByRedirect += droppedFromSample;

  // Remove the confirmed-bad IDs from the full list.
  // IDs not in the sample are passed through — trusted by the search hint.
  const badIds = new Set(
    sample.filter((id, i) => results[i] === null)
  );
  const confirmed = ids.filter(id => !badIds.has(id));

  return { confirmed, droppedCount: droppedFromSample };
}

// ── Search one topic ───────────────────────────────────────────────────────

async function fetchVideos(topic) {
  spendQuota(SEARCH_COST, `search "${topic}"`);

  const url = `https://www.googleapis.com/youtube/v3/search` +
    `?part=id` +
    `&type=video` +
    `&videoDuration=short` +
    `&q=${encodeURIComponent(topic + ' #shorts')}` +
    `&maxResults=${MAX_RESULTS}` +
    `&key=${process.env.YOUTUBE_API_KEY}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error)                             { console.error(`  API error for "${topic}":`, data.error); return []; }
    if (!data.items || data.items.length === 0) { console.warn(`  No results for "${topic}"`);             return []; }

    const candidates = data.items.map(i => i.id.videoId).filter(Boolean);

    // Spot-check a small sample — full list passes through minus confirmed bad IDs
    const { confirmed, droppedCount } = await spotCheck(candidates, REDIRECT_SAMPLE);

    if (droppedCount > 0) process.stdout.write(` (spot-check dropped ${droppedCount}/${REDIRECT_SAMPLE})`);

    return confirmed.map(id => ({ id, topics: [topic] }));
  } catch (err) {
    console.error(`  Fetch error for "${topic}":`, err);
    return [];
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const topicsToRun = shuffleArray([...TOPICS]).slice(0, MAX_TOPICS);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' BOITube Shorts Feed Generator');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Quota limit      : ${QUOTA_LIMIT} units`);
  console.log(` Safety buffer    : ${QUOTA_BUFFER} units`);
  console.log(` Usable budget    : ${QUOTA_LIMIT - QUOTA_BUFFER} units`);
  console.log(` Cost per topic   : ${COST_PER_TOPIC} units (search only)`);
  console.log(` Topics to run    : ${topicsToRun.length} / ${TOPICS.length}`);
  console.log(` Results/topic    : ${MAX_RESULTS}`);
  console.log(` Est. max spend   : ${topicsToRun.length * COST_PER_TOPIC} units`);
  console.log(` Spot-check       : ${REDIRECT_SAMPLE}/${MAX_RESULTS} per topic (~${topicsToRun.length * REDIRECT_SAMPLE} total HEAD requests)`);
  console.log(` Redirect concur. : ${REDIRECT_CONCURRENCY} parallel, ${REDIRECT_DELAY_MS}ms between batches`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const videoTopicMap = new Map();

  for (const topic of topicsToRun) {
    process.stdout.write(`[${topic}] `);
    const videos = await fetchVideos(topic);
    console.log(`→ ${videos.length} Shorts  (quota: ${quotaUsed}/${QUOTA_LIMIT})`);

    for (const { id, topics } of videos) {
      if (videoTopicMap.has(id)) {
        for (const t of topics) videoTopicMap.get(id).add(t);
      } else {
        videoTopicMap.set(id, new Set(topics));
      }
    }
  }

  let feed = Array.from(videoTopicMap.entries()).map(([id, topicSet]) => ({
    id,
    topics: Array.from(topicSet)
  }));
  feed = shuffleArray(feed);

  fs.writeFileSync('feed.json', JSON.stringify(feed, null, 2));

  // ── Summary ──
  const spotCheckRate = totalChecked > 0
    ? ((totalDroppedByRedirect / totalChecked) * 100).toFixed(1)
    : '0.0';

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` ✅ Done — ${feed.length} unique Shorts in feed`);
  console.log(` 📊 Quota used    : ${quotaUsed} / ${QUOTA_LIMIT} (${QUOTA_LIMIT - quotaUsed} remaining)`);
  console.log(` 🔍 Spot-check    : ${totalDroppedByRedirect} non-Shorts caught in ${totalChecked} sampled (${spotCheckRate}% bad rate)`);
  console.log(` 💡 Est. non-Short leakage: ~${Math.round((parseFloat(spotCheckRate)/100) * feed.length)} videos in feed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const topicCount = {};
  for (const { topics } of feed) {
    for (const t of topics) topicCount[t] = (topicCount[t] || 0) + 1;
  }
  const sorted = Object.entries(topicCount).sort((a, b) => b[1] - a[1]);
  console.log('Top 15 topics by video count:');
  sorted.slice(0, 15).forEach(([t, n]) => console.log(`  ${String(n).padStart(4)}  ${t}`));
})();
