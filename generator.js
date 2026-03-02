const fetch = require('node-fetch');
const fs = require('fs');

const TOPICS = [
  "Vlogging",
  "Workspace",
  "Tutorials",
  "Lifehacks",
  "Transformations",
  "Food",
  "Pets",
  "DIY",
  "Unboxing",
  "Tech",
  "Gaming",
  "Sports",
  "Fitness",
  "Fashion",
  "Beauty",
  "Reactions",
  "Comedy",
  "Trends",
  "Nostalgia",
  "Trivia",
  "Debunking",
  "Timelapse",
  "ASMR",
  "Experiments",
  "Careers",
  "Facts",
  "Travel",
  "Automotive",
  "Science",
  "Motivation",
  "POV",
  "Remix",
  "Storytime",
  "Finance",
  "Productivity",
  "Tips",
  "Music",
  "VTubing",
  "Faceless",
  "Packing",
  "Decor",
  "Modding",
  "Culture",
  "News",
  "Hauls",
  "Comparison",
  "Reviews",
  "Challenges",
  "Hobbies",
  "Branding",

  // Popular Creators
  "MrBeast",
  "RyanTrahan",
  "KhabyLame",
  "ZachKing",
  "MarkRober",
  "AlanChikinChow",
  "BrentRivera",
  "BellaPoarch",
  "IShowSpeed",
  "NickDiGiovanni",
  "PrestonPlayz",
  "DharMann",

  // Popular Games
  "Minecraft",
  "Fortnite",
  "Roblox",
  "GTAV",
  "Warzone",
  "Valorant",
  "ApexLegends",
  "AmongUs",
  "EASportsFC",
  "RocketLeague",
  "LeagueOfLegends",
  "ClashRoyale",

  // Extra Topics to reach 100
  "Minimalism",
  "Routines",
  "Glowups",
  "Cooking",
  "Baking",
  "Streetfood",
  "Animation",
  "Editing",
  "Photography",
  "Cinematics",
  "Skits",
  "Commentary",
  "Interviews",
  "Pranks",
  "Giveaways",
  "Budgeting",
  "Investing",
  "Startups",
  "Coding",
  "AI",
  "Gadgets",
  "Repairs",
  "Builds",
  "Speedruns",
  "Strategy",
  "Survival"
];

// Utility: shuffle an array
function shuffleArray(array) {
  return array.sort(() => Math.random() - 0.5);
}

// Fetch videos from YouTube for a single topic
async function fetchVideos(topic) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=id&type=video&videoDuration=short&q=${encodeURIComponent(topic)}&maxResults=50&key=${process.env.YOUTUBE_API_KEY}`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error(`YouTube API error for topic "${topic}":`, data.error);
      return [];
    }

    if (!data.items || data.items.length === 0) {
      console.warn(`No videos found for topic "${topic}"`);
      return [];
    }

    return data.items.map(i => i.id.videoId).filter(id => !!id);
  } catch (err) {
    console.error(`Fetch error for topic "${topic}":`, err);
    return [];
  }
}

// Main function
(async () => {
  console.log("Generating new YouTube Shorts feed...");

  let feed = [];

  for (let topic of TOPICS) {
    const videos = await fetchVideos(topic);
    feed.push(...videos);
    console.log(`Fetched ${videos.length} videos for topic: ${topic}`);
  }

  // Deduplicate and shuffle
  feed = shuffleArray([...new Set(feed)]);

  // Save feed.json
  fs.writeFileSync('feed.json', JSON.stringify(feed, null, 2));
  console.log(`Feed generated with ${feed.length} videos.`);
})();
