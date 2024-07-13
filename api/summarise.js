const fetch = require('node-fetch');

module.exports = async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing URL parameter' });
  }

  try {
    // TODO: Implement actual transcript fetching and summarisation
    const transcript = await fetchTranscript(url);
    const summary = await summariseText(transcript);

    res.status(200).json({ transcript, summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

async function fetchTranscript(url) {
  // Placeholder: In a real implementation, you'd use a YouTube transcript API
  return `This is a placeholder transcript for the video at ${url}`;
}

async function summariseText(text) {
  // Placeholder: In a real implementation, you'd use a text summarisation API
  return `This is a placeholder summary for the transcript: ${text.slice(0, 50)}...`;
}