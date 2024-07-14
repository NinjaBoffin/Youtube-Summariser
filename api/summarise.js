const { YoutubeTranscript } = require('youtube-transcript-api');

module.exports = async (req, res) => {
  try {
    console.log('Function invoked with query:', req.query);
    const { url } = req.query;

    if (!url) {
      console.log('Missing URL parameter');
      return res.status(400).json({ error: 'Missing URL parameter' });
    }

    console.log('Extracting video ID from URL:', url);
    const videoId = extractVideoId(url);
    console.log('Extracted Video ID:', videoId);

    if (!videoId) {
      console.log('Invalid YouTube URL');
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    console.log('Fetching transcript for video:', videoId);
    const transcript = await fetchTranscript(videoId);
    console.log('Transcript fetched successfully, length:', transcript.length);

    console.log('Summarizing text');
    const summary = await summariseText(transcript);
    console.log('Summary generated, length:', summary.length);

    res.status(200).json({ 
      transcript,
      summary,
      message: `Transcript fetched and summarized successfully for video: ${videoId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in serverless function:', error);
    res.status(500).json({ 
      error: 'An error occurred in the serverless function',
      details: error.message,
      stack: error.stack,
      name: error.name
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
    const transcriptArray = await YoutubeTranscript.fetchTranscript(videoId);
    return transcriptArray.map(item => item.text).join(' ');
  } catch (error) {
    console.error('Error fetching transcript:', error);
    throw new Error(`Failed to fetch transcript: ${error.message}`);
  }
}

function summariseText(text) {
  // For now, we'll just return the first 200 characters as a simple summary
  return text.slice(0, 200) + '...';
}