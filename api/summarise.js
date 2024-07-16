const { YoutubeTranscript } = require('youtube-transcript');
const { HfInference } = require('@huggingface/inference');
const NodeCache = require('node-cache');
const axios = require('axios');
const natural = require('natural');

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const hf = new HfInference(HUGGINGFACE_API_KEY);

const cache = new NodeCache({ stdTTL: 3600 });
const analyticsCache = new NodeCache({ stdTTL: 86400 });

const SUMMARY_TIMEOUT = 55000;
const MAX_SEGMENTS = 5;

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

    console.log('Segmenting transcript');
    const segments = segmentTranscript(transcript);
    console.log('Summarizing segments');
    const summaries = await summarizeSegments(segments);
    console.log('Structuring summary');
    const structuredSummary = structureSummary(summaries);
    console.log('Extracting key points');
    const keyPoints = extractKeyPoints(structuredSummary);

    console.log('Structured summary and key points generated');

    const result = {
      metadata,
      transcript: formatTranscript(transcript),
      summary: structuredSummary,
      keyPoints,
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
      text: decodeHTMLEntities(item.text),
      start: item.offset,
      duration: item.duration
    }));
  } catch (error) {
    console.error('Error fetching transcript:', error);
    throw new Error(`Failed to fetch transcript: ${error.message}`);
  }
}

function segmentTranscript(transcript) {
  const totalDuration = transcript.reduce((sum, item) => sum + item.duration, 0);
  const segmentDuration = Math.ceil(totalDuration / MAX_SEGMENTS);

  const segments = [];
  let currentSegment = [];
  let currentDuration = 0;
  let segmentStart = transcript[0].start;

  for (const item of transcript) {
    currentSegment.push(item);
    currentDuration += item.duration;

    if (currentDuration >= segmentDuration || item === transcript[transcript.length - 1]) {
      segments.push({
        text: currentSegment.map(i => i.text).join(' '),
        start: segmentStart,
        end: item.start + item.duration
      });
      currentSegment = [];
      segmentStart = item.start + item.duration;
      currentDuration = 0;
    }
  }

  return segments;
}

async function summarizeSegments(segments) {
  return Promise.all(segments.map(async segment => {
    try {
      const summary = await summarizeTextWithTimeout(segment.text);
      return {
        summary,
        start: segment.start,
        end: segment.end
      };
    } catch (error) {
      console.error('Error summarizing segment:', error);
      return {
        summary: 'Error summarizing this segment.',
        start: segment.start,
        end: segment.end
      };
    }
  }));
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
    
    const result = await hf.textGeneration({
      model: 'gpt2',
      inputs: `Summarize the following text:\n\n${text}\n\nSummary:`,
      parameters: {
        max_new_tokens: 150,
        temperature: 0.7,
        top_p: 0.9,
        repetition_penalty: 1.2,
        no_repeat_ngram_size: 3
      }
    });
    
    console.log('Summarization successful');
    const summary = result.generated_text.split('Summary:')[1].trim();
    return summary;
  } catch (error) {
    console.error('Summarization error:', error);
    throw new Error('Failed to generate summary: ' + error.message);
  }
}

function structureSummary(summaries) {
  let structuredSummary = "Video Summary:\n\n";

  summaries.forEach((summary, index) => {
    const formattedStart = formatTimestamp(summary.start);
    const formattedEnd = formatTimestamp(summary.end);
    structuredSummary += `Chapter ${index + 1} [${formattedStart} - ${formattedEnd}]:\n${summary.summary}\n\n`;
  });

  return structuredSummary;
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

function extractKeyPoints(summary) {
  const tokenizer = new natural.SentenceTokenizer();
  const sentences = tokenizer.tokenize(summary);
  
  const tfidf = new natural.TfIdf();
  sentences.forEach(sentence => tfidf.addDocument(sentence));

  const keyPoints = sentences.map((sentence, index) => {
    const terms = tfidf.listTerms(index);
    const score = terms.reduce((sum, term) => sum + term.tfidf, 0);
    return { sentence, score };
  });

  keyPoints.sort((a, b) => b.score - a.score);
  return keyPoints.slice(0, 5).map(point => point.sentence);
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
    responseBody.details = 'The Hugging Face API rate limit has been reached. Please try again later or subscribe to a plan at https://huggingface.co/pricing';
  } else if (errorMessage.includes('Timeout')) {
    statusCode = 504;
    responseBody.error = 'Timeout';
    responseBody.details = 'The request timed out. Please try again with a shorter video or increase the timeout limit.';
  } else if (errorMessage.includes('blob')) {
    responseBody.error = 'Hugging Face API error';
    responseBody.details = 'An error occurred while fetching the blob from the Hugging Face API. Please try again later.';
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
    responseBody.huggingFaceApiKey = HUGGINGFACE_API_KEY ? 'Set' : 'Not set';
    responseBody.youtubeApiKey = YOUTUBE_API_KEY ? 'Set' : 'Not set';
  }

  res.status(statusCode).json(responseBody);
}

function validateVideoLength(transcript) {
  const MAX_TRANSCRIPT_LENGTH = 100000;
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    throw new Error(`Video transcript is too long (${transcript.length} characters). Maximum allowed is ${MAX_TRANSCRIPT_LENGTH} characters.`);
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
  return text.replace(/&[#A-Za-z0-9]+;/g, entity => entities[entity] || entity);
}

function recordUsage(videoId) {
  const currentCount = analyticsCache.get(videoId) || 0;
  analyticsCache.set(videoId, currentCount + 1);
}