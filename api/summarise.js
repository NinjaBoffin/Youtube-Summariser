const { YoutubeTranscript } = require('youtube-transcript');

module.exports = async (req, res) => {
  try {
    const { url } = req.query;

    console.log('Function invoked with URL:', url);

    if (!url) {
      return res.status(400).json({ error: 'Missing URL parameter' });
    }

    const videoId = extractVideoId(url);
    console.log('Extracted Video ID:', videoId);

    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    console.log('Fetching transcript for video:', videoId);
    const transcript = await fetchTranscript(videoId);
    console.log('Transcript fetched, length:', transcript.length);

    const summary = summarizeText(transcript.map(item => item.text).join(' '));
    console.log('Summary generated, length:', summary.length);

    res.status(200).json({ 
      transcript: decodeHTMLEntities(transcript.map(item => `${item.timestamp} ${item.text}`).join('\n')),
      summary: decodeHTMLEntities(summary),
      message: `Transcript fetched and summarized for video: ${videoId}`,
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
    const transcriptArray = await YoutubeTranscript.fetchTranscript(videoId);
    return transcriptArray.map(item => ({
      text: item.text,
      timestamp: formatTimestamp(item.offset / 1000)
    }));
  } catch (error) {
    console.error('Error fetching transcript:', error);
    throw new Error(`Failed to fetch transcript: ${error.message}`);
  }
}

function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function summarizeText(text, maxChunkSize = 10000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxChunkSize) {
    chunks.push(text.slice(i, i + maxChunkSize));
  }
  
  const summaries = chunks.map(chunk => {
    const sentences = chunk.match(/[^\.!\?]+[\.!\?]+/g);
    if (!sentences || sentences.length === 0) {
      return "Unable to generate summary. Text too short or improperly formatted.";
    }
    const avgLength = chunk.length / sentences.length;
    const summary = sentences.filter((sentence, index) => {
      if (index === 0 || index === sentences.length - 1) return true;
      if (sentence.length > avgLength) return true;
      if (index % 5 === 0) return true;
      return false;
    });
    return summary.join(' ');
  });

  return summaries.join(' ');
}

function decodeHTMLEntities(text) {
  const entities = {
    '&#39;': "'",
    '&quot;': '"',
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&'
  };
  return text.replace(/&#?\w+;/g, match => entities[match] || match);
}