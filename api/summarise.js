const { YoutubeTranscript } = require('youtube-transcript');
const { HfInference } = require('@huggingface/inference');

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const hf = new HfInference(HUGGINGFACE_API_KEY);

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

    const summary = await summarizeText(transcript.map(item => item.text).join(' '));
    console.log('Summary generated, length:', summary.length);

    res.status(200).json({ 
      transcript: transcript.map(item => `${item.timestamp} ${decodeHTMLEntities(item.text)}`).join('\n'),
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

async function summarizeText(text) {
  try {
    console.log('Attempting to summarize text...');
    const result = await hf.summarization({
      model: 'facebook/bart-large-cnn',
      inputs: text.slice(0, 1000), // Limit input to 1000 characters for this test
      parameters: {
        max_length: 150,
        min_length: 30,
        do_sample: false
      }
    });
    console.log('Summarization successful');
    return result.summary_text;
  } catch (error) {
    console.error('Summarization error:', error);
    return 'Failed to generate summary. ' + error.message;
  }
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