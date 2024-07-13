const { YoutubeTranscript } = require('youtube-transcript');

module.exports = async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing URL parameter' });
  }

  try {
    const transcript = await fetchTranscript(url);
    const summary = await summariseText(transcript);

    res.status(200).json({ transcript, summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

async function fetchTranscript(url) {
  try {
    const videoId = extractVideoId(url);
    const transcriptArray = await YoutubeTranscript.fetchTranscript(videoId);
    return transcriptArray.map(item => item.text).join(' ');
  } catch (error) {
    throw new Error('Failed to fetch transcript: ' + error.message);
  }
}

function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    return match[2];
  } else {
    throw new Error('Invalid YouTube URL');
  }
}

async function summariseText(text) {
  // TODO: Implement actual summarization
  return `This is a placeholder summary for the transcript: ${text.slice(0, 200)}...`;
}