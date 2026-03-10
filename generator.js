const fetch = require('node-fetch');
const fs = require('fs');

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
  "MrBeast", "RyanTrahan",  "ZachKing", "MarkRober","IShowSpeed",
  "NickDiGiovanni",
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

// Utility: shuffle an array
function shuffleArray(array) {
  return array.sort(() => Math.random() - 0.5);
}

// Fetch videos from YouTube for a single topic
async function fetchVideos(topic) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=id,snippet&type=video&videoDuration=short&q=${encodeURIComponent(topic)}&maxResults=50&key=${process.env.YOUTUBE_API_KEY}`;

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

    return data.items
      .filter(i => i.id && i.id.videoId)
      .map(i => ({
        id: i.id.videoId,
        topic,
        channel: i.snippet?.channelTitle || null
      }));

  } catch (err) {
    console.error(`Fetch error for topic "${topic}":`, err);
    return [];
  }
}

// Main function
(async () => {
  console.log("Generating new YouTube Shorts feed...");

  // Map: videoId -> { id, topics: [], channel }
  const videoMap = new Map();

  for (let topic of TOPICS) {
    const videos = await fetchVideos(topic);

    for (const video of videos) {
      if (videoMap.has(video.id)) {
        // Video already seen — just add this topic if not already listed
        const existing = videoMap.get(video.id);
        if (!existing.topics.includes(video.topic)) {
          existing.topics.push(video.topic);
        }
      } else {
        videoMap.set(video.id, {
          id: video.id,
          topics: [video.topic],
          channel: video.channel
        });
      }
    }

    console.log(`Fetched ${videos.length} videos for topic: ${topic}`);
  }

  // Convert map to array and shuffle
  let feed = shuffleArray([...videoMap.values()]);

  // Save feed.json
  fs.writeFileSync('feed.json', JSON.stringify(feed, null, 2));
  console.log(`\nFeed generated with ${feed.length} unique videos.`);
})();
