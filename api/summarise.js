const { YoutubeTranscript } = require('youtube-transcript');
const NodeCache = require('node-cache');
const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const cache = new NodeCache({ stdTTL: 3600 });
const analyticsCache = new NodeCache({ stdTTL: 86400 });

const MAX_SEGMENTS = 5;
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
      timestamp: new Date().toISOString()
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
      start: item.offset,
      duration: item.duration
    }));
  } catch (error) {
    console.error('Error fetching transcript:', error);
    throw new Error(`Failed to fetch transcript: ${error.message}`);
  }
}

async function summarizeTranscript(transcript) {
  const chunks = chunkTranscript(transcript);
  const summaries = [];

  for (const chunk of chunks) {
    const chunkText = chunk.map(item => `[${formatTimestamp(item.start)}] ${item.text}`).join('\n');
    
    const prompt = `Summarize the following video transcript chunk. Provide a concise summary of the main points discussed:

Transcript chunk:
${chunkText}

Summary:`;

    try {
      const response = await axios.post('https://api.openai.com/v1/engines/text-davinci-002/completions', {
        prompt: prompt,
        max_tokens: 150,
        temperature: 0.5,
      }, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      summaries.push(response.data.choices[0].text.trim());
    } catch (error) {
      console.error('Error in OpenAI API call:', error);
      summaries.push('Error summarizing this chunk.');
    }
  }

  return combineChunkSummaries(summaries, transcript[0].start, transcript[transcript.length - 1].start + transcript[transcript.length - 1].duration);
}

function chunkTranscript(transcript) {
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const item of transcript) {
    if (currentLength + item.text.length > MAX_CHUNK_LENGTH) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }
    currentChunk.push(item);
    currentLength += item.text.length;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function combineChunkSummaries(summaries, startTime, endTime) {
  const totalDuration = endTime - startTime;
  const segmentDuration = Math.floor(totalDuration / summaries.length);

  let combinedSummary = "Video Summary:\n\n";

  summaries.forEach((summary, index) => {
    const segmentStart = startTime + (index * segmentDuration);
    const segmentEnd = index === summaries.length - 1 ? endTime : segmentStart + segmentDuration;
    const formattedStart = formatTimestamp(segmentStart);
    const formattedEnd = formatTimestamp(segmentEnd);
    combinedSummary += `Chapter ${index + 1} [${formattedStart} - ${formattedEnd}]:\n${summary}\n\n`;
  });

  return combinedSummary;
}

function formatTimestamp(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatTranscript(transcript) {
  return transcript.map(item => {
    const formattedTime = formatTimestamp(item.start);
    return `[${formattedTime}] ${item.text}`;
  }).join('\n');
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
  return text.replace(/&([^;]+);/g, function(match, entity) {
    return entities[match] || match;
  });
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