const NodeCache = require('node-cache');
const analyticsCache = new NodeCache({ stdTTL: 86400 }); // Cache for 24 hours

module.exports = {
  recordUsage: (videoId) => {
    const currentCount = analyticsCache.get(videoId) || 0;
    analyticsCache.set(videoId, currentCount + 1);
  },
  getTopVideos: () => {
    const keys = analyticsCache.keys();
    return keys.map(key => ({ videoId: key, count: analyticsCache.get(key) }))
               .sort((a, b) => b.count - a.count)
               .slice(0, 10);
  }
};