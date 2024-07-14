const { YoutubeTranscript } = require('youtube-transcript-api');

module.exports = async (req, res) => {
  try {
    const { url } = req.query;

    console.log('Received URL:', url);

    if (!url) {
      return res.status(400).json({ error: 'Missing URL parameter' });
    }

    const videoId = extractVideoId(url);
    console.log('Extracted Video ID:', videoId);

    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const transcript = await fetchTranscript(videoId);
    const summary = await summariseText(transcript);

    res.status(200).json({ 
      transcript,
      summary,
      message: `Transcript fetched successfully for video: ${videoId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in serverless function:', error);
    res.status(500).json({ 
      error: 'An error occurred in the serverless function',
      details: error.message,
      stack: error.stack
    });
  }
};

function extractVideoId(url) {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

async function fetchTranscript(videoId) {
  try {
    console.log('Fetching transcript for video:', videoId);
    const transcriptArray = await YoutubeTranscript.fetchTranscript(videoId);
    console.log('Transcript fetched successfully');
    return transcriptArray.map(item => item.text).join(' ');
  } catch (error) {
    console.error('Error fetching transcript:', error);
    throw new Error(`Failed to fetch transcript: ${error.message}`);
  }
}

async function summariseText(text) {
  // For now, we'll just return the first 200 characters as a simple summary
  return text.slice(0, 200) + '...';
}