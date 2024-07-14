const { YoutubeTranscript } = require('youtube-transcript');
const { HfInference } = require('@huggingface/inference');
const cache = require('./cache');
const analytics = require('./analytics');

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

    const cachedResult = cache.get(videoId);
    if (cachedResult) {
      console.log('Returning cached result');
      return res.status(200).json(cachedResult);
    }

    console.log('Fetching transcript for video:', videoId);
    const transcript = await fetchTranscript(videoId);
    console.log('Transcript fetched, length:', transcript.length);

    validateVideoLength(transcript);

    const summary = await summarizeText(transcript.map(item => item.text).join(' '));
    console.log('Summary generated, length:', summary.length);

    const result = {
      transcript: transcript.map(item => `${item.timestamp} ${decodeHTMLEntities(item.text)}`).join('\n'),
      summary: decodeHTMLEntities(summary),
      message: `Transcript fetched and summarized for video: ${videoId}`,
      timestamp: new Date().toISOString()
    };

    cache.set(videoId, result);
    analytics.recordUsage(videoId);

    res.status(200).json(result);
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
    const chunks = splitTextIntoChunks(text, 1000);
    const summaries = await Promise.all(chunks.map(async (chunk) => {
      const result = await hf.summarization({
        model: 'facebook/bart-large-cnn',
        inputs: chunk,
        parameters: {
          max_length: 150,
          min_length: 30,
          do_sample: false
        }
      });
      return result.summary_text;
    }));
    console.log('Summarization successful');
    return summaries.join(' ');
  } catch (error) {
    console.error('Summarization error:', error);
    return 'Failed to generate summary. ' + error.message;
  }
}

function splitTextIntoChunks(text, maxLength) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLength));
    i += maxLength;
  }
  return chunks;
}

function validateVideoLength(transcript) {
  const MAX_TRANSCRIPT_LENGTH = 100000; // Adjust as needed
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    throw new Error(`Video transcript is too long (${transcript.length} characters). Maximum allowed is ${MAX_TRANSCRIPT_LENGTH} characters.`);
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