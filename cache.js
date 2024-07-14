const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

module.exports = {
  get: (key) => cache.get(key),
  set: (key, value) => cache.set(key, value),
};