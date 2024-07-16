const { YoutubeTranscript } = require('youtube-transcript');
const { HfInference } = require('@huggingface/inference');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const hf = new HfInference(HUGGINGFACE_API_KEY);

const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour
const analyticsCache = new NodeCache({ stdTTL: 86400 }); // Cache for 24 hours

const SUMMARY_TIMEOUT = 55000; // 55 seconds to stay within the 60-second limit

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

module.exports = limiter(async (req, res) => {
  try {
    const { url } = req.query;

    console.log('Function invoked with URL:', url);

    if (!url) {
      return res.status(400).json({ error: 'Missing URL parameter' });
    }

    // Improved URL validation
    if (!isValidYouTubeUrl(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const videoId = extractVideoId(url);
    console.log('Extracted Video ID:', videoId);

    const cachedResult = cache.get(videoId);
    if (cachedResult) {
      console.log('Returning cached result');
      return res.status(200).json(cachedResult);
    }

    console.log('Fetching transcript for video:', videoId);
    const transcript = await fetchTranscript(videoId);
    console.log('Transcript fetched, length:', transcript.length);

    validateVideoLength(transcript);

    const segments = segmentTranscript(transcript);
    const summaries = await summarizeSegments(segments);
    const structuredSummary = structureSummary(summaries);

    console.log('Structured summary generated');

    const result = {
      transcript: transcript.map(item => `${item.timestamp} ${decodeHTMLEntities(item.text)}`).join('\n'),
      summary: structuredSummary,
      message: `Transcript fetched and summarized for video: ${videoId}`,
      timestamp: new Date().toISOString()
    };

    cache.set(videoId, result);
    recordUsage(videoId);

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in serverless function:', error);
    handleError(res, error);
  }
});

// Improved YouTube URL validation
function isValidYouTubeUrl(url) {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
  return youtubeRegex.test(url);
}

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

// Segment the transcript into chunks of approximately 300 words
function segmentTranscript(transcript) {
  const segments = [];
  let currentSegment = [];
  let wordCount = 0;

  for (const item of transcript) {
    currentSegment.push(item);
    wordCount += item.text.split(' ').length;

    if (wordCount >= 300 || item.text.endsWith('.')) {
      segments.push(currentSegment);
      currentSegment = [];
      wordCount = 0;
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}

// Summarize each segment, handling errors for individual segments
async function summarizeSegments(segments) {
  const summaries = [];

  for (const segment of segments) {
    try {
      const segmentText = segment.map(item => item.text).join(' ');
      const summary = await summarizeTextWithTimeout(segmentText);
      summaries.push(summary);
    } catch (error) {
      console.error('Error summarizing segment:', error);
      summaries.push('Error summarizing this segment.');
    }
  }

  return summaries;
}

async function summarizeTextWithTimeout(text) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), SUMMARY_TIMEOUT);
    
    summarizeText(text)
      .then(result => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

async function summarizeText(text) {
  try {
    console.log('Attempting to summarize text...');
    if (!HUGGINGFACE_API_KEY) {
      throw new Error('HUGGINGFACE_API_KEY is not set');
    }
    const result = await hf.summarization({
      model: 'facebook/bart-large-cnn',
      inputs: text,
      parameters: {
        max_length: 100,
        min_length: 30,
        do_sample: false
      }
    });
    console.log('Summarization successful');
    return result.summary_text;
  } catch (error) {
    console.error('Summarization error:', error);
    throw new Error('Failed to generate summary: ' + error.message);
  }
}

// Structure the summary into chapters with bullet points
function structureSummary(summaries) {
  let structuredSummary = "Video Summary:\n\n";

  summaries.forEach((summary, index) => {
    structuredSummary += `Chapter ${index + 1}:\n`;
    const points = extractKeyPoints(summary);
    points.forEach(point => {
      structuredSummary += `- ${point}\n`;
    });
    structuredSummary += '\n';
  });

  return structuredSummary;
}

// Extract key points from a summary (simple sentence splitting)
function extractKeyPoints(summary) {
  // This is a simple implementation. You might want to use NLP techniques for better results.
  const sentences = summary.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.map(s => s.trim());
}

function handleError(res, error) {
  console.error('Error details:', error);

  const errorMessage = error.message || 'An unexpected error occurred';
  const timestamp = new Date().toISOString();

  let statusCode = 500;
  let responseBody = {
    error: 'An error occurred in the serverless function',
    details: errorMessage,
    timestamp: timestamp
  };

  if (errorMessage.includes('Rate limit reached')) {
    statusCode = 429;
    responseBody = {
      error: 'Rate limit reached',
      details: 'The Hugging Face API rate limit has been reached. Please try again later or subscribe to a plan at https://huggingface.co/pricing',
      timestamp: timestamp
    };
  } else if (errorMessage.includes('Timeout')) {
    statusCode = 504;
    responseBody = {
      error: 'Timeout',
      details: 'The request timed out. Please try again with a shorter video or increase the timeout limit.',
      timestamp: timestamp
    };
  } else if (errorMessage.includes('blob')) {
    responseBody = {
      error: 'Hugging Face API error',
      details: 'An error occurred while fetching the blob from the Hugging Face API. Please try again later.',
      timestamp: timestamp
    };
  }

  // Add additional debug information in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    responseBody.stack = error.stack;
    responseBody.name = error.name;
    responseBody.huggingFaceApiKey = HUGGINGFACE_API_KEY ? 'Set' : 'Not set';
  }

  res.status(statusCode).json(responseBody);
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

function recordUsage(videoId) {
  const currentCount = analyticsCache.get(videoId) || 0;
  analyticsCache.set(videoId, currentCount + 1);
}