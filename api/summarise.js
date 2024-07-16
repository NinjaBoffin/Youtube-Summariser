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

module.exports = (req, res) => {
  // Wrap the entire function in a try-catch block
  try {
    // Ensure the response is always JSON
    res.setHeader('Content-Type', 'application/json');

    // Use an async IIFE to allow top-level await
    (async () => {
      try {
        const { url } = req.query;

        console.log('Function invoked with URL:', url);

        if (!url || !isValidYouTubeUrl(url)) {
          return handleError(res, new Error('Invalid YouTube URL'));
        }

        const videoId = extractVideoId(url);
        console.log('Extracted Video ID:', videoId);

        if (!videoId) {
          return handleError(res, new Error('Could not extract video ID'));
        }

        const cachedResult = cache.get(videoId);
        if (cachedResult) {
          console.log('Returning cached result');
          return res.status(200).json(cachedResult);
        }

        const metadata = await fetchVideoMetadata(videoId);
        console.log('Fetched video metadata');

        const transcript = await fetchTranscript(videoId);
        console.log('Transcript fetched, length:', transcript.length);

        validateVideoLength(transcript);

        const segments = segmentTranscript(transcript);
        const summaries = await summarizeSegments(segments);
        const structuredSummary = structureSummary(summaries);
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

        return res.status(200).json(result);
      } catch (error) {
        console.error('Error in serverless function:', error);
        return handleError(res, error);
      }
    })().catch(error => {
      console.error('Unhandled promise rejection:', error);
      return handleError(res, error);
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return handleError(res, error);
  }
};

async function fetchVideoMetadata(videoId) {
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
      text: item.text,
      start: item.offset,
      duration: item.duration
    }));
  } catch (error) {
    console.error('Error fetching transcript:', error);
    throw new Error(`Failed to fetch transcript: ${error.message}`);
  }
}

function segmentTranscript(transcript) {
  const segments = [];
  let currentSegment = [];
  let wordCount = 0;
  let segmentStart = 0;

  for (const item of transcript) {
    currentSegment.push(item);
    wordCount += item.text.split(' ').length;

    if (wordCount >= 300 || item.text.endsWith('.')) {
      segments.push({
        text: currentSegment.map(i => i.text).join(' '),
        start: segmentStart,
        end: item.start + item.duration
      });
      currentSegment = [];
      wordCount = 0;
      segmentStart = item.start + item.duration;
    }
  }

  if (currentSegment.length > 0) {
    const lastItem = currentSegment[currentSegment.length - 1];
    segments.push({
      text: currentSegment.map(i => i.text).join(' '),
      start: segmentStart,
      end: lastItem.start + lastItem.duration
    });
  }

  return segments;
}

async function summarizeSegments(segments) {
  const summaries = [];

  for (const segment of segments) {
    try {
      const summary = await summarizeTextWithTimeout(segment.text);
      summaries.push({
        summary,
        start: segment.start,
        end: segment.end
      });
    } catch (error) {
      console.error('Error summarizing segment:', error);
      summaries.push({
        summary: 'Error summarizing this segment.',
        start: segment.start,
        end: segment.end
      });
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

function structureSummary(summaries) {
  let structuredSummary = "Video Summary:\n\n";

  summaries.forEach((summary, index) => {
    const formattedStart = formatTimestamp(summary.start / 1000);
    const formattedEnd = formatTimestamp(summary.end / 1000);
    structuredSummary += `Chapter ${index + 1} [${formattedStart} - ${formattedEnd}]:\n${summary.summary}\n\n`;
  });

  return structuredSummary;
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

function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatTranscript(transcript) {
  return transcript.map(item => {
    const formattedTime = formatTimestamp(item.start / 1000);
    return `[${formattedTime}] ${item.text}`;
  }).join('\n');
}

function recordUsage(videoId) {
  const currentCount = analyticsCache.get(videoId) || 0;
  analyticsCache.set(videoId, currentCount + 1);
}