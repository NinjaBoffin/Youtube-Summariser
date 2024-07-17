const { YoutubeTranscript } = require('youtube-transcript');
const NodeCache = require('node-cache');
const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const cache = new NodeCache({ stdTTL: 3600 });
const analyticsCache = new NodeCache({ stdTTL: 86400 });

const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 10;
const MIN_SEGMENT_DURATION = 60; // 1 minute
const MAX_SEGMENT_DURATION = 600; // 10 minutes
const MAX_CHUNK_LENGTH = 4000;

module.exports = async (req, res) => {
  console.log('Function started');
  try {
    res.setHeader('Content-Type', 'application/json');

    const { url } = req.query;
    console.log('Function invoked with URL:', url);

    if (!url || !isValidYouTubeUrl(url)) {
      console.log('Invalid YouTube URL');
      return handleError(res, new Error('Invalid YouTube URL'));
    }

    const videoId = extractVideoId(url);
    console.log('Extracted Video ID:', videoId);

    if (!videoId) {
      console.log('Could not extract video ID');
      return handleError(res, new Error('Could not extract video ID'));
    }

    const cachedResult = cache.get(videoId);
    if (cachedResult) {
      console.log('Returning cached result');
      return res.status(200).json(cachedResult);
    }

    console.log('Fetching video metadata');
    let metadata;
    try {
      metadata = await fetchVideoMetadata(videoId);
      console.log('Fetched video metadata');
    } catch (error) {
      console.error('Error fetching metadata:', error);
      metadata = { error: 'Failed to fetch video metadata' };
    }

    console.log('Fetching transcript');
    const transcript = await fetchTranscript(videoId);
    console.log('Transcript fetched, length:', transcript.length);

    validateVideoLength(transcript);

    console.log('Summarizing transcript');
    const summary = await summarizeTranscript(transcript);
    console.log('Summary generated');

    const result = {
      metadata,
      transcript: formatTranscript(transcript),
      summary: summary,
      message: `Transcript fetched and summarized for video: ${videoId}`,
      timestamp: new Date().toISOString(),
      debug: {
        openAIKeySet: !!OPENAI_API_KEY,
        youtubeKeySet: !!YOUTUBE_API_KEY
      }
    };

    cache.set(videoId, result);
    recordUsage(videoId);

    console.log('Sending successful response');
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in main function:', error);
    return handleError(res, error);
  }
};

function isValidYouTubeUrl(url) {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
  return youtubeRegex.test(url);
}

function extractVideoId(url) {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

async function fetchVideoMetadata(videoId) {
  if (!YOUTUBE_API_KEY) {
    console.warn('YOUTUBE_API_KEY is not set. Skipping metadata fetch.');
    return { error: 'YouTube API key is not set' };
  }
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${YOUTUBE_API_KEY}`;
  const response = await axios.get(url);
  const videoData = response.data.items[0];
  return {
    title: videoData.snippet.title,
    description: videoData.snippet.description,
    publishedAt: videoData.snippet.publishedAt,
    duration: videoData.contentDetails.duration
  };
}

async function fetchTranscript(videoId) {
  try {
    const transcriptArray = await YoutubeTranscript.fetchTranscript(videoId);
    if (!transcriptArray || transcriptArray.length === 0) {
      throw new Error('Empty transcript returned');
    }
    return transcriptArray.map(item => ({
      text: decodeHTMLEntities(item.text),
      offset: item.offset,
      duration: item.duration
    }));
  } catch (error) {
    console.error('Error fetching transcript:', error);
    throw new Error(`Failed to fetch transcript: ${error.message}`);
  }
}

async function summarizeTranscript(transcript) {
  const chunks = dynamicChunkTranscript(transcript);
  const summaries = [];

  for (const [index, chunk] of chunks.entries()) {
    const chunkText = chunk.map(item => item.text).join(' ');
    const startTime = formatTimestamp(chunk[0].offset);
    const endTime = formatTimestamp(chunk[chunk.length - 1].offset + chunk[chunk.length - 1].duration);
    console.log(`Summarizing chunk ${index + 1}/${chunks.length}: ${startTime} - ${endTime}`);

    try {
      const summary = await summarizeWithOpenAI(chunkText, startTime, endTime);
      summaries.push(summary);
    } catch (error) {
      console.error('Error in OpenAI API call:', error.response ? error.response.data : error.message);
      const fallbackSummary = generateFallbackSummary(chunkText, startTime, endTime);
      summaries.push(fallbackSummary);
    }
  }

  return summaries.join('\n\n');
}

function dynamicChunkTranscript(transcript) {
  const totalDuration = transcript[transcript.length - 1].offset + transcript[transcript.length - 1].duration;
  const optimalSegmentCount = Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, Math.floor(totalDuration / 300))); // Aim for 5-minute segments
  const targetSegmentDuration = totalDuration / optimalSegmentCount;

  const chunks = [];
  let currentChunk = [];
  let currentDuration = 0;
  let lastBreakpoint = 0;

  for (let i = 0; i < transcript.length; i++) {
    const item = transcript[i];
    currentChunk.push(item);
    currentDuration += item.duration;

    if (currentDuration >= targetSegmentDuration || i === transcript.length - 1) {
      // Look for a good breakpoint (end of a sentence)
      let breakpointIndex = i;
      for (let j = i; j >= lastBreakpoint; j--) {
        if (transcript[j].text.match(/[.!?]$/)) {
          breakpointIndex = j;
          break;
        }
      }

      chunks.push(transcript.slice(lastBreakpoint, breakpointIndex + 1));
      lastBreakpoint = breakpointIndex + 1;
      currentChunk = [];
      currentDuration = 0;
    }
  }

  return chunks;
}

function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}

function formatTranscript(transcript) {
  return transcript.map(item => `[${formatTimestamp(item.offset)}] ${item.text}`).join('\n');
}

function validateVideoLength(transcript) {
  const MAX_TRANSCRIPT_LENGTH = 100000;
  const totalLength = transcript.reduce((sum, item) => sum + item.text.length, 0);
  if (totalLength > MAX_TRANSCRIPT_LENGTH) {
    throw new Error(`Video transcript is too long (${totalLength} characters). Maximum allowed is ${MAX_TRANSCRIPT_LENGTH} characters.`);
  }
}

function decodeHTMLEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&#x2F;': '/',
    '&#x60;': '`',
    '&#x3D;': '='
  };
  return text.replace(/&([^;]+);/g, (match, entity) => entities[match] || match);
}

function handleError(res, error) {
  console.error('Handling error:', error);

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
    responseBody.error = 'Rate limit reached';
    responseBody.details = 'An API rate limit has been reached. Please try again later.';
  } else if (errorMessage.includes('Timeout')) {
    statusCode = 504;
    responseBody.error = 'Timeout';
    responseBody.details = 'The request timed out. Please try again with a shorter video or increase the timeout limit.';
  } else if (errorMessage.includes('Failed to fetch transcript')) {
    statusCode = 404;
    responseBody.error = 'Transcript not found';
    responseBody.details = 'Unable to fetch the transcript for this video. It may not be available or the video might be private.';
  } else if (errorMessage.includes('Video transcript is too long')) {
    statusCode = 413;
    responseBody.error = 'Video too long';
    responseBody.details = errorMessage;
  } else if (errorMessage.includes('Invalid YouTube URL')) {
    statusCode = 400;
    responseBody.error = 'Invalid input';
    responseBody.details = 'The provided URL is not a valid YouTube URL.';
  } else if (errorMessage.includes('Could not extract video ID')) {
    statusCode = 400;
    responseBody.error = 'Invalid input';
    responseBody.details = 'Could not extract a valid video ID from the provided URL.';
  }

  if (process.env.NODE_ENV !== 'production') {
    responseBody.stack = error.stack;
    responseBody.name = error.name;
    responseBody.openAIApiKey = OPENAI_API_KEY ? 'Set' : 'Not set';
    responseBody.youtubeApiKey = YOUTUBE_API_KEY ? 'Set' : 'Not set';
  }

  res.status(statusCode).json(responseBody);
}

function recordUsage(videoId) {
  const currentCount = analyticsCache.get(videoId) || 0;
  analyticsCache.set(videoId, currentCount + 1);
}